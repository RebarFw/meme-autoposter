"""Read-only weekly R2 risk report for two Cloudflare accounts.

Only Cloudflare GraphQL analytics is queried. This does not read billing invoices,
change subscriptions, modify Workers, or operate on R2 objects.
"""
import json
import os
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.request import Request, urlopen

ACCOUNTS = (
    ("English", "97d19512e831722d5d48aa2d05086716", "CF_ENGLISH_ANALYTICS_TOKEN"),
    ("Arabic", "7d7578de8373f18cc730837758c40395", "CF_ARABIC_ANALYTICS_TOKEN"),
)
API = "https://api.cloudflare.com/client/v4/graphql"
GB = 1_000_000_000
CLASS_A = {
    "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
    "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
    "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
    "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
}
CLASS_B = {
    "HeadBucket", "HeadObject", "GetObject", "UsageSummary",
    "GetBucketEncryption", "GetBucketLocation", "GetBucketCors",
    "GetBucketLifecycleConfiguration",
}
FREE_OPS = {"DeleteObject", "DeleteBucket", "AbortMultipartUpload"}


def nonnegative(value):
    if type(value) is not int or value < 0:
        raise ValueError("Invalid analytics counter")
    return value


def graphql(account_id, token):
    now = datetime.now(timezone.utc)
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    storage_start = now - timedelta(days=3)
    query = """query WeeklyR2 {
      viewer {
        accounts(filter: { accountTag: "__ACCOUNT__" }) {
          r2OperationsAdaptiveGroups(
            limit: 1000,
            filter: { datetime_geq: "__MONTH__", datetime_leq: "__NOW__" }
          ) { sum { requests } dimensions { actionType storageClass } }
          r2StorageAdaptiveGroups(
            limit: 1000,
            filter: { datetime_geq: "__STORAGE__", datetime_leq: "__NOW__" }
          ) {
            max { payloadSize metadataSize }
            dimensions { bucketName storageClass datetime }
          }
        }
      }
    }"""
    for marker, value in (
        ("__ACCOUNT__", account_id),
        ("__MONTH__", month.isoformat().replace("+00:00", "Z")),
        ("__STORAGE__", storage_start.isoformat().replace("+00:00", "Z")),
        ("__NOW__", now.isoformat().replace("+00:00", "Z")),
    ):
        query = query.replace(marker, value)
    request = Request(
        API,
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=25) as response:
        data = json.load(response)
    if data.get("errors"):
        raise ValueError("Cloudflare GraphQL returned errors")
    accounts = data.get("data", {}).get("viewer", {}).get("accounts")
    if not isinstance(accounts, list) or len(accounts) != 1:
        raise ValueError("Cloudflare account analytics unavailable")
    account = accounts[0]
    operations = account.get("r2OperationsAdaptiveGroups")
    storage = account.get("r2StorageAdaptiveGroups")
    if not isinstance(operations, list) or len(operations) >= 1000:
        raise ValueError("R2 operations analytics unavailable/truncated")
    if not isinstance(storage, list) or not storage or len(storage) >= 1000:
        raise ValueError("R2 storage analytics unavailable/truncated")
    return operations, storage


def check_account(name, account_id, secret_name):
    token = os.getenv(secret_name, "").strip()
    if not token:
        return f"{name}: CHECK - read-only API token missing.", True
    try:
        operations, storage = graphql(account_id, token)
        a = b = 0
        warnings = []
        for row in operations:
            dims = row["dimensions"]
            n = nonnegative(row["sum"]["requests"])
            kind = dims["actionType"]
            storage_class = dims["storageClass"]
            if not isinstance(kind, str) or not isinstance(storage_class, str):
                raise ValueError("Invalid operation dimension")
            if kind not in FREE_OPS:
                if kind in CLASS_A or kind not in CLASS_B:
                    a += n
                if kind in CLASS_B or kind not in CLASS_A:
                    b += n
                if kind not in CLASS_A and kind not in CLASS_B and n:
                    warnings.append("unknown operation type")
            if storage_class != "Standard" and n:
                warnings.append("non-Standard R2 operation")

        # Use the freshest reported sample for every bucket/storage class;
        # do not sum snapshots across timestamps.
        latest = {}
        for row in storage:
            dims = row["dimensions"]
            key = (dims["bucketName"], dims["storageClass"])
            stamp = dims["datetime"]
            if not all(isinstance(x, str) and x for x in (*key, stamp)):
                raise ValueError("Invalid storage dimensions")
            amount = nonnegative(row["max"]["payloadSize"]) + nonnegative(row["max"]["metadataSize"])
            if key not in latest or stamp > latest[key][0]:
                latest[key] = (stamp, amount)

        bytes_stored = sum(amount for (_, amount) in latest.values())
        if any(storage_class != "Standard" and amount > 0
               for (_, storage_class), (_, amount) in latest.items()):
            warnings.append("non-Standard R2 storage")
        if bytes_stored >= 8 * GB:
            warnings.append("storage approaching 10 GB-month free allowance")
        if a >= 800_000:
            warnings.append("Class A operations approaching 1M/month")
        if b >= 8_000_000:
            warnings.append("Class B operations approaching 10M/month")

        label = "CHECK" if warnings else "OK (analytics only)"
        line = (f"{name}: {label}\n"
                f"  Stored now: {bytes_stored / GB:.2f} GB; "
                f"R2 ops this month: A {a:,}/1,000,000, B {b:,}/10,000,000")
        if warnings:
            line += "\n  Warning: " + ", ".join(sorted(set(warnings)))
        return line, bool(warnings)
    except Exception:
        # Never treat missing/partial analytics as zero; don't log API secrets/errors.
        return f"{name}: CHECK - couldn't verify Cloudflare analytics.", True


def main():
    sender = os.getenv("GMAIL_ADDRESS", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "")
    recipient = os.getenv("REPORT_EMAIL_TO", "").strip() or sender
    if not sender or not password or not recipient:
        raise SystemExit("Gmail secret setup incomplete; no email was sent.")

    results = [check_account(*account) for account in ACCOUNTS]
    flagged = any(warning for _, warning in results)
    body = (
        "Weekly Cloudflare R2 check (read-only)\n\n"
        + "\n\n".join(line for line, _ in results)
        + "\n\nIMPORTANT: Analytics are estimates, not billing meters. "
          "Storage GB now is NOT GB-month billed. Actual invoices, other "
          "services and Observability subscription are NOT checked.\n"
          "Review each account's Cloudflare Dashboard > Billing > Billable Usage "
          "and Observability plan to confirm no charges.\n"
    )
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "[Cloudflare Weekly] " + ("CHECK usage" if flagged else "R2 within warning thresholds")
    message.set_content(body)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
    print("Weekly Cloudflare email sent. No Cloudflare mutations performed.")


if __name__ == "__main__":
    main()
