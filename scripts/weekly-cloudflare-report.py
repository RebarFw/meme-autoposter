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
    storage_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    query = """query WeeklyR2 {
      viewer {
        accounts(filter: { accountTag: "__ACCOUNT__" }) {
          monthOps: r2OperationsAdaptiveGroups(
            limit: 1000,
            filter: { datetime_geq: "__MONTH__", datetime_leq: "__NOW__" }
          ) { sum { requests } dimensions { actionType storageClass } }
          weekOps: r2OperationsAdaptiveGroups(
            limit: 1000,
            filter: { datetime_geq: "__WEEK__", datetime_leq: "__NOW__" }
          ) { sum { requests } dimensions { actionType storageClass } }
          r2StorageAdaptiveGroups(
            limit: 1000,
            filter: { datetime_geq: "__STORAGE__", datetime_leq: "__NOW__" }
          ) {
            max { payloadSize metadataSize }
            dimensions { bucketName storageClass }
          }
        }
      }
    }"""
    for marker, value in (
        ("__ACCOUNT__", account_id),
        ("__MONTH__", month.isoformat().replace("+00:00", "Z")),
        ("__STORAGE__", storage_start.isoformat().replace("+00:00", "Z")),
        ("__WEEK__", week_start.isoformat().replace("+00:00", "Z")),
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
    operations = account.get("monthOps")
    weekly_operations = account.get("weekOps")
    storage = account.get("r2StorageAdaptiveGroups")
    if not isinstance(operations, list) or len(operations) >= 1000:
        raise ValueError("R2 operations analytics unavailable/truncated")
    if not isinstance(weekly_operations, list) or len(weekly_operations) >= 1000:
        raise ValueError("Weekly R2 operations unavailable/truncated")
    if not isinstance(storage, list) or not storage or len(storage) >= 1000:
        raise ValueError("R2 storage analytics unavailable/truncated")
    return operations, weekly_operations, storage


def count_operations(rows):
    """Count R2 Class A and B actions conservatively, flagging unknown types."""
    a = b = 0
    warnings = []
    for row in rows:
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
                warnings.append("unrecognized operation type; request totals may be overstated")
        if storage_class != "Standard" and n:
            warnings.append("non-Standard R2 operation")
    return a, b, warnings


def format_storage(amount):
    if amount == 0:
        return "0 bytes"
    if amount < 1_000_000:
        return f"{amount / 1_000:.1f} KB"
    if amount < GB:
        return f"{amount / 1_000_000:.2f} MB"
    return f"{amount / GB:.3f} GB"


def operation_line(label, monthly, weekly, free_limit):
    used = monthly / free_limit * 100
    remaining = max(0, free_limit - monthly)
    return (f"  {label}: {monthly:,} / {free_limit:,} this month "
            f"({used:.3f}% used, {remaining:,} left); last 7 days: {weekly:,}")


def check_account(name, account_id, secret_name):
    token = os.getenv(secret_name, "").strip()
    if not token:
        return f"{name}: CHECK - read-only API token missing.", True
    try:
        operations, weekly_operations, storage = graphql(account_id, token)
        a, b, warnings = count_operations(operations)
        week_a, week_b, week_warnings = count_operations(weekly_operations)
        warnings.extend(week_warnings)

        # Each returned bucket/storage-class group reports max size today.
        latest = {}
        for row in storage:
            dims = row["dimensions"]
            key = (dims["bucketName"], dims["storageClass"])
            if not all(isinstance(x, str) and x for x in key):
                raise ValueError("Invalid storage dimensions")
            amount = nonnegative(row["max"]["payloadSize"]) + nonnegative(row["max"]["metadataSize"])
            if key in latest:
                raise ValueError("Duplicated storage dimension")
            latest[key] = amount

        bytes_stored = sum(latest.values())
        if any(storage_class != "Standard" and amount > 0
               for (_, storage_class), amount in latest.items()):
            warnings.append("non-Standard R2 storage")
        if bytes_stored >= 8 * GB:
            warnings.append("storage approaching 10 GB-month free allowance")
        if a >= 800_000:
            warnings.append("Class A operations approaching 1M/month")
        if b >= 8_000_000:
            warnings.append("Class B operations approaching 10M/month")

        usage_pct = max(a / 1_000_000, b / 10_000_000)
        label = ("CHECK" if warnings else
                 "WATCH" if usage_pct >= 0.5 else "LOW")
        line = (f"{name} R2: {label}\n"
                f"  Storage snapshot today: {format_storage(bytes_stored)} "
                f"(free storage measured in GB-month)\n"
                + operation_line("Class A", a, week_a, 1_000_000) + "\n"
                + operation_line("Class B", b, week_b, 10_000_000))
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
        f"CLOUDFLARE FREE-TIER WATCH | {datetime.now(timezone.utc):%d %b %Y} (UTC)\n"
        + ("ACTION: Check the warnings below.\n\n" if flagged
           else "R2 operation limits: no warning thresholds reached.\n\n")
        + "\n\n".join(line for line, _ in results)
        + "\n\nNOTE: Free R2 Standard storage is 10 GB-month per account. "
          "Today's storage snapshot does not show GB-month used or remaining. "
          "Operations are month-to-date estimates, not an invoice. "
          "Billing charges, other Cloudflare services and Observability plans "
          "are NOT verified. Check Cloudflare > Billing > Billable Usage for "
          "each account; this report cannot guarantee $0 charges.\n"
    )
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "[Cloudflare Weekly] " + ("CHECK usage" if flagged else "R2 free-tier headroom")
    message.set_content(body)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
    print("Weekly Cloudflare email sent. No Cloudflare mutations performed.")


if __name__ == "__main__":
    main()
