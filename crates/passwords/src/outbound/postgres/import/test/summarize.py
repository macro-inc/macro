"""Summarize disposable import_performance output and redacted OpenBao audit JSON."""

import argparse
from datetime import datetime
import json
from pathlib import Path
import statistics


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        raise ValueError("Missing audit or pool samples; do not report an incomplete run")
    return ordered[int((len(ordered) - 1) * fraction)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    args = parser.parse_args()
    runs = [json.loads(line[7:]) for line in args.runs.read_text().splitlines()
            if line.startswith("PWCONC ")]
    if not runs:
        raise ValueError("No completed benchmark runs")

    requests = {}
    responses = {}
    for line in args.audit.open():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not all(key in event for key in ("time", "request", "type")):
            continue
        identity = event["request"]["id"]
        when = instant(event["time"])
        if event["type"] == "request":
            requests[identity] = when
        elif event["type"] == "response" and identity in requests:
            start = requests[identity]
            responses[identity] = (start, (when - start).total_seconds() * 1000)

    for run in runs:
        start, finish = instant(run["started_at"]), instant(run["finished_at"])
        latencies = [duration for when, duration in responses.values() if start <= when <= finish]
        # Five KV calls per fresh item, one TOTP write for every fifth item,
        # and the real logins counted by the adapter's authentication span.
        expected = run["items"] * 5 + run["items"] // 5 + run["logins"]
        if len(latencies) != expected:
            raise ValueError("Incomplete provider audit capture; use JSON-file logging and follow it before starting")
        run["bao_p50_ms"] = percentile(latencies, 0.5)
        run["bao_p95_ms"] = percentile(latencies, 0.95)
        run["acquire_p95_ms"] = percentile(run["acquire_ms"], 0.95)

    print("| N | Items | ms/item | Total ms | Batch ms | Pool checked-out/raw max | Acquire p95 ms | Bao p50/p95 ms | Lease total ms |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for concurrency in sorted({run["concurrency"] for run in runs}):
        for size in sorted({run["items"] for run in runs}):
            group = [run for run in runs if run["concurrency"] == concurrency and run["items"] == size]
            if len(group) < 3:
                raise ValueError("At least three runs per configuration are required")
            per_item = statistics.median(run["ms_per_item"] for run in group)
            total = statistics.median(run["wall_ms"] for run in group)
            batch = statistics.median(value for run in group for value in run["batches_ms"])
            pool = max(run["pool_max"] for run in group)
            raw = max(run["pool_raw_max"] for run in group)
            acquire = max(run["acquire_p95_ms"] for run in group)
            p50 = statistics.median(run["bao_p50_ms"] for run in group)
            p95 = max(run["bao_p95_ms"] for run in group)
            held = statistics.median(sum(run["leases_ms"]) for run in group)
            print(f"| {concurrency} | {size} | {per_item:.2f} | {total:.0f} | {batch:.0f} | {pool}/{raw} of 20 | {acquire:.2f} | {p50:.2f}/{p95:.2f} | {held:.0f} |")
    print("Times and Bao p50 are medians; pool and p95 columns use the worst run. Bao latency is audit request-to-response time.")
    print("Import failures:", sum(run["errors"] for run in runs), "token retries:", sum(run["token_retries"] for run in runs))


if __name__ == "__main__":
    main()
