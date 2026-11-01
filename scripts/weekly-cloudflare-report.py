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
from html import escape
from urllib.request import Request, urlopen

ACCOUNTS = (
    ("English", "97d19512e831722d5d48aa2d05086716", "CF_ENGLISH_ANALYTICS_TOKEN",
     "meme-autoposter", "1b806c2e-6ced-4845-a694-3fbf13af0b79", "meme-autoposter"),
    ("Arabic", "7d7578de8373f18cc730837758c40395", "CF_ARABIC_ANALYTICS_TOKEN",
     "arabic-meme-autoposter", "2e47dbbf-e082-4579-9d34-c101c98ebb5b", "arabic-meme-autoposter"),
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
        return f"{name}: CHECK - read-only API token missing.", True, None
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
        return line, bool(warnings), {
            "status": label, "storage_bytes": bytes_stored,
            "class_a": a, "class_b": b,
            "week_a": week_a, "week_b": week_b,
            "warnings": sorted(set(warnings)),
        }
    except Exception:
        # Never treat missing/partial analytics as zero; don't log API secrets/errors.
        return f"{name}: CHECK - couldn't verify Cloudflare analytics.", True, None



def query_extra(account_id, token, query, markers):
    for marker, value in markers.items():
        query = query.replace(marker, value)
    request = Request(
        API, data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=25) as response:
        data = json.load(response)
    if data.get("errors"):
        raise ValueError("Additional analytics unavailable")
    accounts = data.get("data", {}).get("viewer", {}).get("accounts")
    if not isinstance(accounts, list) or len(accounts) != 1:
        raise ValueError("Account analytics unavailable")
    return accounts[0]


def worker_analytics(account_id, token, worker):
    """Optional read-only Workers metrics; not invoice-grade usage."""
    now = datetime.now(timezone.utc)
    markers = {
        "__ACCOUNT__": account_id, "__WORKER__": worker,
        "__NOW__": now.isoformat().replace("+00:00", "Z"),
        "__DAY__": (now - timedelta(days=1)).isoformat().replace("+00:00", "Z"),
        "__WEEK__": (now - timedelta(days=7)).isoformat().replace("+00:00", "Z"),
    }
    query = """query WorkersReport {
      viewer { accounts(filter: { accountTag: "__ACCOUNT__" }) {
        lastDay: workersInvocationsAdaptive(
          limit: 1, filter: {
            scriptName: "__WORKER__", datetime_geq: "__DAY__", datetime_leq: "__NOW__"
          }
        ) { sum { requests errors } quantiles { cpuTimeP99 } }
        lastWeek: workersInvocationsAdaptive(
          limit: 1, filter: {
            scriptName: "__WORKER__", datetime_geq: "__WEEK__", datetime_leq: "__NOW__"
          }
        ) { sum { requests errors } }
      } }
    }"""
    data = query_extra(account_id, token, query, markers)
    def totals(key):
        rows = data.get(key)
        if not isinstance(rows, list) or len(rows) > 1:
            raise ValueError("Workers data missing/truncated")
        if not rows:
            return {"requests": 0, "errors": 0, "p99": None}
        sums = rows[0].get("sum", {})
        quantiles = rows[0].get("quantiles") or {}
        return {
            "requests": nonnegative(sums["requests"]),
            "errors": nonnegative(sums["errors"]),
            "p99": quantiles.get("cpuTimeP99"),
        }
    return {"day": totals("lastDay"), "week": totals("lastWeek")}


def d1_analytics(account_id, token, database_id):
    """Optional read-only D1 metrics; daily snapshots, not actual bills."""
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    week = (now.date() - timedelta(days=6)).isoformat()
    query = """query D1Report {
      viewer { accounts(filter: { accountTag: "__ACCOUNT__" }) {
        lastDay: d1AnalyticsAdaptiveGroups(
          limit: 100, filter: { date_geq: "__TODAY__", date_leq: "__TODAY__", databaseId: "__DB__" }
        ) { sum { rowsRead rowsWritten readQueries writeQueries } }
        lastWeek: d1AnalyticsAdaptiveGroups(
          limit: 100, filter: { date_geq: "__WEEK__", date_leq: "__TODAY__", databaseId: "__DB__" }
        ) { sum { rowsRead rowsWritten readQueries writeQueries } }
        storage: d1StorageAdaptiveGroups(
          limit: 100, filter: { date_geq: "__TODAY__", date_leq: "__TODAY__", databaseId: "__DB__" }
        ) { max { databaseSizeBytes } }
      } }
    }"""
    data = query_extra(account_id, token, query, {
        "__ACCOUNT__": account_id, "__DB__": database_id,
        "__TODAY__": today, "__WEEK__": week,
    })
    def totals(key):
        rows = data.get(key)
        if not isinstance(rows, list) or len(rows) >= 100:
            raise ValueError("D1 data missing/truncated")
        return {field: sum(nonnegative(row["sum"][field]) for row in rows)
                for field in ("rowsRead", "rowsWritten", "readQueries", "writeQueries")}
    storage_rows = data.get("storage")
    if not isinstance(storage_rows, list) or len(storage_rows) >= 100:
        raise ValueError("D1 storage unavailable/truncated")
    # No storage sample is NOT a zero-byte database.
    storage_bytes = (max(nonnegative(row["max"]["databaseSizeBytes"])
                         for row in storage_rows) if storage_rows else None)
    return {"day": totals("lastDay"), "week": totals("lastWeek"),
            "storage_bytes": storage_bytes}


def github_check(repo):
    """Public GitHub CI status; does not claim that Instagram posting succeeded."""
    request = Request(
        "https://api.github.com/repos/RebarFw/" + repo
        + "/actions/workflows/check.yml/runs?per_page=10",
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "weekly-cloudflare-usage-report"},
    )
    with urlopen(request, timeout=15) as response:
        data = json.load(response)
    runs = data.get("workflow_runs")
    if not isinstance(runs, list):
        raise ValueError("GitHub check data unavailable")
    finished = next((item for item in runs if item.get("status") == "completed"), None)
    if not finished:
        return {"conclusion": "no completed run", "date": None}
    conclusion = finished.get("conclusion")
    if conclusion not in ("success", "failure", "cancelled", "timed_out", "skipped"):
        conclusion = "unknown"
    return {"conclusion": conclusion, "date": finished.get("updated_at")}


def optional_metrics(account):
    name, account_id, secret_name, worker, database, repo = account
    token = os.getenv(secret_name, "").strip()
    result = {"workers": None, "d1": None, "github": None}
    if token:
        try:
            result["workers"] = worker_analytics(account_id, token, worker)
        except Exception:
            pass  # Optional dataset errors must not conceal verified R2 data.
        try:
            result["d1"] = d1_analytics(account_id, token, database)
        except Exception:
            pass
    try:
        result["github"] = github_check(repo)
    except Exception:
        pass
    return result


def number(value):
    return f"{value:,}"


def storage_text(value):
    return "Unavailable" if value is None else format_storage(value)


def status_color(status):
    return {"LOW": "#047857", "WATCH": "#a16207", "CHECK": "#b91c1c"}.get(status, "#475569")


def badge(label, color):
    return (f'<span style="display:inline-block;border-radius:999px;padding:5px 10px;'
            f'font:700 11px Arial,sans-serif;background:#f1f5f9;color:{color};'
            f'border:1px solid {color}40;">{escape(label)}</span>')


def metric_bar(label, used, free_limit, footnote):
    pct = used / free_limit * 100
    width = min(pct, 100)
    color = "#dc2626" if pct >= 80 else "#d97706" if pct >= 50 else "#059669"
    shown = "<0.01%" if 0 < pct < 0.01 else f"{pct:.2f}%"
    return (f'<tr><td style="padding:10px 0 6px;">'
            f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
            f'<td style="font:600 13px Arial;color:#334155;">{escape(label)}</td>'
            f'<td align="right" style="font:700 13px Arial;color:#0f172a;">'
            f'{number(used)} / {number(free_limit)}</td></tr></table>'
            f'<div style="height:7px;background:#e2e8f0;border-radius:8px;margin:9px 0 6px;">'
            f'<div style="height:7px;width:{width:.4f}%;background:{color};border-radius:8px;"></div></div>'
            f'<div style="font:12px Arial;color:#64748b;">{shown} of monthly reference &middot; '
            f'{escape(footnote)}</div></td></tr>')


def small_tile(title, value, subtitle):
    return (f'<td width="50%" valign="top" style="padding:8px;">'
            f'<div style="background:#f8fafc;border:1px solid #e2e8f0;'
            f'border-radius:10px;padding:14px;">'
            f'<div style="color:#64748b;font:12px Arial;">{escape(title)}</div>'
            f'<div style="color:#0f172a;font:bold 20px Arial;margin-top:7px;">{escape(str(value))}</div>'
            f'<div style="color:#64748b;font:11px Arial;margin-top:4px;">{escape(subtitle)}</div>'
            f'</div></td>')


def section_header(title, subtitle=""):
    return (f'<div style="font:700 14px Arial;color:#0f172a;margin:16px 0 5px;">'
            f'{escape(title)}</div>'
            f'<div style="font:12px Arial;color:#64748b;margin-bottom:10px;">'
            f'{escape(subtitle)}</div>')


def account_html(item):
    name = escape(item["name"])
    r2 = item["r2"]
    metrics = item["extra"]
    color = status_color(r2["status"] if r2 else "CHECK")
    label = r2["status"] if r2 else "CHECK"
    out = (f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
           f'style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;'
           f'margin:18px 0;"><tr><td style="padding:20px;">'
           f'<table width="100%" role="presentation"><tr><td '
           f'style="font:bold 19px Arial;color:#0f172a;">{name} Account</td>'
           f'<td align="right">{badge(label + " R2", color)}</td></tr></table>')
    if r2 is None:
        out += '<p style="font:13px Arial;color:#b91c1c;">R2 usage unavailable. Check analytics token and workflow.</p>'
    else:
        out += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
        out += small_tile("R2 stored today", format_storage(r2["storage_bytes"]),
                          "Snapshot, not GB-month")
        out += small_tile("R2 operations last 7d", number(r2["week_a"] + r2["week_b"]),
                          f'A: {number(r2["week_a"])} · B: {number(r2["week_b"])}')
        out += '</tr></table>'
        out += '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
        out += metric_bar("R2 Class A", r2["class_a"], 1_000_000,
                          f'{number(max(0, 1_000_000-r2["class_a"]))} remaining')
        out += metric_bar("R2 Class B", r2["class_b"], 10_000_000,
                          f'{number(max(0, 10_000_000-r2["class_b"]))} remaining')
        out += '</table>'
        if r2["warnings"]:
            out += (f'<div style="background:#fef2f2;border-radius:8px;padding:10px;'
                    f'font:12px Arial;color:#991b1b;">'
                    f'{escape("; ".join(r2["warnings"]))}</div>')
    out += section_header("Workers", "Execution analytics; not billed-request totals")
    workers = metrics["workers"]
    if workers is None:
        out += '<p style="font:12px Arial;color:#a16207;">Worker analytics unavailable (not assumed zero).</p>'
    else:
        out += '<table role="presentation" width="100%"><tr>'
        out += small_tile("Requests · last 24h", number(workers["day"]["requests"]),
                          f'{number(workers["day"]["errors"])} runtime errors')
        out += small_tile("Requests · last 7d", number(workers["week"]["requests"]),
                          f'{number(workers["week"]["errors"])} runtime errors')
        out += '</tr></table>'
        if workers["week"]["errors"]:
            out += '<p style="font:12px Arial;color:#b91c1c;">Worker runtime errors detected — inspect Workers metrics.</p>'
    out += section_header("D1 Database", "Rows scanned/written; account-level billing not verified")
    d1 = metrics["d1"]
    if d1 is None:
        out += '<p style="font:12px Arial;color:#a16207;">D1 analytics unavailable (not assumed zero).</p>'
    else:
        out += '<table role="presentation" width="100%"><tr>'
        out += small_tile("Rows read · today UTC", number(d1["day"]["rowsRead"]),
                          f'{number(d1["week"]["rowsRead"])} last 7 calendar days')
        out += small_tile("Rows written · today UTC", number(d1["day"]["rowsWritten"]),
                          f'{number(d1["week"]["rowsWritten"])} last 7 calendar days')
        out += '</tr></table>'
        out += (f'<div style="font:12px Arial;color:#64748b;margin:8px 0;">'
                f'D1 storage snapshot: <b>{escape(storage_text(d1["storage_bytes"]))}</b>'
                f' &middot; Today: {number(d1["day"]["readQueries"])} read queries, '
                f'{number(d1["day"]["writeQueries"])} write queries.</div>')
        if d1["day"]["rowsRead"] >= 4_000_000 or d1["day"]["rowsWritten"] >= 80_000:
            out += '<p style="font:12px Arial;color:#b91c1c;">D1 daily activity is near the Workers Free plan reference limits; verify actual plan and billing.</p>'
    github = metrics["github"]
    if github is None:
        github_line = "GitHub CI status unavailable"
    else:
        github_line = "GitHub CI last completed check: " + github["conclusion"]
        if github.get("date"):
            github_line += " (" + github["date"][:10] + ")"
    out += (f'<div style="font:12px Arial;color:#64748b;padding:12px 0 0;'
            f'border-top:1px solid #e2e8f0;margin-top:16px;">'
            f'{escape(github_line)} &middot; Instagram publishing metrics not connected</div>')
    out += '</td></tr></table>'
    return out


def render_html(items, generated_at):
    flagged = any(item["flagged"] for item in items)
    available = all(item["r2"] is not None and item["extra"]["workers"] is not None
                    and item["extra"]["d1"] is not None for item in items)
    heading = "Action needed" if flagged else ("R2 safe · partial data" if not available else "R2 usage looks safe")
    heading_color = "#fecaca" if flagged else "#bbf7d0"
    account_cards = "".join(account_html(item) for item in items)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;">
<tr><td style="background:#0f172a;border-radius:16px 16px 0 0;padding:28px 26px;">
<div style="font:700 12px Arial;color:#f59e0b;letter-spacing:2px;">CLOUDFLARE / WEEKLY WATCH</div>
<h1 style="font:bold 27px Arial;color:#ffffff;margin:12px 0 8px;">Usage &amp; Automation Dashboard</h1>
<div style="font:13px Arial;color:#94a3b8;">{escape(generated_at)} UTC &middot; English + Arabic</div>
<div style="font:bold 13px Arial;color:{heading_color};margin-top:16px;">&#9679; {escape(heading)}</div>
</td></tr>
<tr><td style="background:#f8fafc;padding:4px 16px 18px;">
{account_cards}
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:18px 16px;">
<div style="font:bold 14px Arial;color:#9a3412;">Billing not verified</div>
<p style="font:12px/1.7 Arial;color:#7c2d12;margin:8px 0 14px;">R2 Standard free storage is 10 GB-month/account; today's snapshot is not GB-month usage. R2 operation totals and Workers/D1 analytics are estimates, not invoices. Other products, subscription charges and Observability plans are not checked. This report cannot guarantee $0 charges.</p>
<a href="https://dash.cloudflare.com/" style="display:inline-block;background:#0f172a;color:#ffffff;font:bold 12px Arial;text-decoration:none;padding:12px 16px;border-radius:8px;">Review Cloudflare Billing &#8594;</a>
</div>
<p style="font:11px/1.6 Arial;color:#64748b;text-align:center;margin:18px 12px 0;">Read-only weekly report. No changes to Workers, databases, storage or billing. GitHub CI is not proof of successful Instagram publishing.</p>
</td></tr></table></td></tr></table></body></html>"""


def render_text(items, generated_at):
    flagged = any(item["flagged"] for item in items)
    body = (f"CLOUDFLARE WEEKLY WATCH | {generated_at} UTC\n"
            + ("ACTION: Verify warnings below.\n\n" if flagged
               else "R2 operation limits: no warning thresholds reached.\n\n"))
    for item in items:
        body += item["line"] + "\n"
        extra = item["extra"]
        w = extra["workers"]
        d = extra["d1"]
        g = extra["github"]
        body += (f'  Workers: 24h {number(w["day"]["requests"])} requests, '
                 f'{number(w["day"]["errors"])} errors; 7d '
                 f'{number(w["week"]["requests"])} requests.\n'
                 if w is not None else "  Workers: analytics unavailable.\n")
        body += (f'  D1: today {number(d["day"]["rowsRead"])} rows read, '
                 f'{number(d["day"]["rowsWritten"])} written; '
                 f'storage snapshot {storage_text(d["storage_bytes"])}.\n'
                 if d is not None else "  D1: analytics unavailable.\n")
        body += (f'  GitHub CI: {g["conclusion"]} last completed run.\n'
                 if g is not None else "  GitHub CI: unavailable.\n")
        body += "  Instagram publish totals: not connected (not verified).\n\n"
    body += ("NOTE: Free R2 Standard storage is 10 GB-month/account; today's storage "
             "snapshot is not GB-month remaining. Metrics are estimates, not a bill. "
             "Actual charges, other Cloudflare services and Observability plans are "
             "NOT verified. Check Cloudflare > Billing > Billable Usage for both "
             "accounts. This report cannot guarantee $0 charges.\n")
    return body


def extra_warning(extra):
    workers = extra["workers"]
    d1 = extra["d1"]
    github = extra["github"]
    return bool(
        (workers is not None and workers["week"]["errors"] > 0)
        or (d1 is not None and (
            d1["day"]["rowsRead"] >= 4_000_000
            or d1["day"]["rowsWritten"] >= 80_000))
        or (github is not None and github["conclusion"] in ("failure", "timed_out"))
    )


def build_message(sender, recipient, items, generated_at):
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    flagged = any(item["flagged"] for item in items)
    message["Subject"] = "[Cloudflare Weekly] " + ("Attention needed" if flagged else "Usage dashboard")
    message.set_content(render_text(items, generated_at))
    message.add_alternative(render_html(items, generated_at), subtype="html")
    return message


def main():
    sender = os.getenv("GMAIL_ADDRESS", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "")
    recipient = os.getenv("REPORT_EMAIL_TO", "").strip() or sender
    if not sender or not password or not recipient:
        raise SystemExit("Gmail secret setup incomplete; no email was sent.")

    items = []
    for account in ACCOUNTS:
        line, flagged, r2 = check_account(*account[:3])
        extra = optional_metrics(account)
        items.append({
            "name": account[0], "line": line,
            "flagged": flagged or extra_warning(extra),
            "r2": r2, "extra": extra,
        })
    message = build_message(sender, recipient, items,
                            datetime.now(timezone.utc).strftime("%d %b %Y"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
    print("Weekly Cloudflare HTML + plain-text email sent. No Cloudflare mutations performed.")


if __name__ == "__main__":
    main()
