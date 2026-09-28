#!/usr/bin/env python3
"""Compare matching GraphQL cache benchmark reports and optionally gate regressions."""

import argparse
import csv
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--csv", type=Path, help="Write all paired p50/p95 measurements")
    parser.add_argument("--max-regression-percent", type=float)
    parser.add_argument("--noise-floor-us", type=float, default=5.0)
    args = parser.parse_args()
    before = json.loads(args.before.read_text())
    after = json.loads(args.after.read_text())
    for field in ("host", "schema_hash", "architecture", "inventory", "disk", "browser_version", "corpus_hash", "cross_origin_isolated", "reduced_timer_precision"):
        if before.get(field) != after.get(field):
            parser.error(f"incompatible reports: {field} differs")
    for field in ("sizes", "variants", "samples", "warmup", "filter", "cold_samples", "scenarios", "cache_records"):
        if before["options"].get(field) != after["options"].get(field):
            parser.error(f"incompatible benchmark options: {field} differs")

    def index(report):
        result = {}
        for row in report["rows"]:
            key = (row["operation"], row["size"], row["scenario"], row.get("cache_records"), row.get("hot_capacity"))
            if key in result:
                parser.error(f"duplicate scenario: {key}")
            result[key] = row
        return result

    old = index(before)
    new = index(after)
    if not old or old.keys() != new.keys():
        parser.error("scenario coverage differs or is empty")
    rows = []
    failed = []
    for key, previous in old.items():
        current = new[key]
        if previous["normalized_records"] != current["normalized_records"]:
            parser.error(f"fixture record count changed: {key}")
        if previous.get("requests_per_read") != current.get("requests_per_read"):
            parser.error(f"request batch count changed: {key}")
        ratio = previous["p50_us"] / current["p50_us"] if min(previous["p50_us"], current["p50_us"]) > 0 else None
        row = {
            "operation": key[0], "size": key[1], "scenario": key[2],
            "cache_records": key[3], "hot_capacity": key[4],
            "before_p50_us": previous["p50_us"], "after_p50_us": current["p50_us"],
            "before_p95_us": previous["p95_us"], "after_p95_us": current["p95_us"],
            "speedup": ratio,
        }
        rows.append(row)
        if args.max_regression_percent is not None:
            delta = current["p50_us"] - previous["p50_us"]
            if delta > args.noise_floor_us and delta > previous["p50_us"] * args.max_regression_percent / 100:
                failed.append(row)
    if args.csv:
        with args.csv.open("w", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
    for row in sorted(rows, key=lambda row: row["speedup"] or 0):
        speedup = f'{row["speedup"]:6.2f}x' if row["speedup"] is not None else "unresolved"
        print(f'{row["operation"]:36} {row["size"]:4} {row["scenario"]:20} '
              f'{row["before_p50_us"]:10.2f} -> {row["after_p50_us"]:10.2f} us '
              f'{speedup}')
    print(f"Compared {len(rows)} scenarios; {len(failed)} exceed the configured regression budget.")
    raise SystemExit(bool(failed))


if __name__ == "__main__":
    main()
