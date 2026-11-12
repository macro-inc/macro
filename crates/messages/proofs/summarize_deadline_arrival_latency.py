#!/usr/bin/env python3
"""Validate the final no-hold fixed-arrival comparison without replacing historical results."""

import argparse
import csv
import math
from pathlib import Path
from statistics import median


FIELDS = (
    "runtime profile mode run connections channels offered_ops_s variant n "
    "arrival_p50_ms arrival_p95_ms arrival_p99_ms service_p50_ms service_p95_ms "
    "service_p99_ms requested_hold_ms actual_hold_p50_ms actual_hold_p95_ms "
    "actual_hold_p99_ms total_wall_ms achieved_ops_s"
).split()
CHANNELS = (1, 16)
RATES = (50, 200, 1000, 3000)


def read_rows(paths):
    rows, seen = [], set()
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.startswith("| multi_thread_16 |"):
                continue
            values = [value.strip() for value in line.strip("|").split("|")]
            assert len(values) == len(FIELDS), (path, line)
            row = dict(zip(FIELDS, values))
            assert row["runtime"] == "multi_thread_16" and row["profile"] == "release", row
            assert row["mode"] == "open_loop" and row["connections"] == "16", row
            assert int(row["channels"]) in CHANNELS and int(row["offered_ops_s"]) in RATES, row
            assert row["variant"] in ("before", "after") and row["n"] == "2000", row
            assert float(row["requested_hold_ms"]) == 0, row
            assert all(float(row[f"actual_hold_p{p}_ms"]) == 0 for p in (50, 95, 99)), row
            for prefix in ("arrival", "service"):
                quantiles = [float(row[f"{prefix}_p{p}_ms"]) for p in (50, 95, 99)]
                assert all(math.isfinite(value) and value > 0 for value in quantiles), row
                assert quantiles == sorted(quantiles), row
            wall, rate = (float(row[field]) for field in ("total_wall_ms", "achieved_ops_s"))
            assert all(math.isfinite(value) and value > 0 for value in (wall, rate)), row
            assert math.isclose(2_000_000 / wall, rate, rel_tol=0.001, abs_tol=0.11), row
            key = (int(row["run"]), int(row["channels"]), int(row["offered_ops_s"]), row["variant"])
            assert key not in seen, ("duplicate result", key)
            seen.add(key)
            rows.append(row)
    expected = {(run, channels, rate, variant)
                for run in range(1, 4) for channels in CHANNELS for rate in RATES
                for variant in ("before", "after")}
    assert seen == expected, ("incomplete comparison", expected - seen, "unexpected", seen - expected)
    assert len(rows) == 48
    return sorted(rows, key=lambda row: (
        int(row["run"]), int(row["channels"]), int(row["offered_ops_s"]), row["variant"] != "before",
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", type=Path, nargs="+")
    parser.add_argument("--source-revision", required=True,
                        help="exact tested deadline implementation revision, including any working-tree qualifier")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    assert args.source_revision.strip()
    assert "\n" not in args.source_revision and "`" not in args.source_revision
    rows = read_rows(args.logs)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "channel_deadline_arrival_latency_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    groups = {}
    for row in rows:
        key = (int(row["channels"]), int(row["offered_ops_s"]), row["variant"])
        groups.setdefault(key, []).append(row)

    def value(key, field):
        return median(float(row[field]) for row in groups[key])

    def latency(key):
        return " / ".join(f"{value(key, f'arrival_p{p}_ms'):.3f}" for p in (50, 95, 99))

    lines = [
        "# Fixed-arrival writes with a total counter deadline", "",
        f"The tested deadline implementation source is `{args.source_revision}`.",
        "The old repository retains the methods, SQL and hydration pinned to",
        "`354da677b5`. The current path sets a total 50 ms counter-allocation",
        "statement deadline, preserving a stricter inherited deadline, in one",
        "round trip before acquiring the counter. The append restores the prior",
        "setting within its statement. Both variants are measured without an",
        "artificial hold. This comparison includes the complete repository change,",
        "not an isolated measurement of deadline configuration cost.", "",
        "Release profile, sixteen Tokio workers and sixteen database connections.",
        "One dedicated local PostgreSQL 18.4 server with files on tmpfs, fsync and",
        "synchronous_commit enabled. This worktree's compiler, plan jobs and tests",
        "were idle during measurement; other worktrees shared the host. This is",
        "not an isolated-host or production-disk measurement.", "",
        "Each of 48 cases has 2,000 mixed writes, 500 each of create, edit, react",
        "and delete, following 128 unmeasured warmups. Three repetitions compare",
        "old/current implementations at 50, 200, 1,000 and 3,000 total arrivals/s",
        "in one and sixteen channels. Operations rotate independently through",
        "channels. Fixture creation, warmup and cleanup are outside measurement.", "",
        "The scheduler retains every original arrival timestamp and runs",
        "independently of completions. Requests queue for one of sixteen workers.",
        "Arrival latency includes scheduler lateness, admission, pool and counter",
        "waits, SQL and commit acknowledgement. Achieved rate includes draining",
        "the final requests. The runner does not retry; repository errors abort",
        "the test, so a full successful matrix cannot silently discard failures.", "",
        "## Three-run comparison", "",
        "All latency values are milliseconds in p50 / p95 / p99 order. Values",
        "are medians of the three per-run percentiles and achieved rates, not",
        "percentiles from pooled samples. Every run is retained below and in CSV.", "",
        "| Channels | Offered writes/s | Old latency ms | Current latency ms | Old achieved writes/s | Current achieved writes/s |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for channels in CHANNELS:
        for rate in RATES:
            old, new = (channels, rate, "before"), (channels, rate, "after")
            lines.append(
                f"| {channels} | {rate} | {latency(old)} | {latency(new)} | "
                f"{value(old, 'achieved_ops_s'):.1f} | {value(new, 'achieved_ops_s'):.1f} |"
            )
    lines += [
        "", "## Every measured run", "",
        "| Run | Channels | Offered writes/s | Variant | Arrival p50 / p95 / p99 ms | Achieved writes/s |",
        "| ---: | ---: | ---: | --- | ---: | ---: |",
    ]
    for row in rows:
        latency = " / ".join(row[f"arrival_p{p}_ms"] for p in (50, 95, 99))
        lines.append(
            f"| {row['run']} | {row['channels']} | {row['offered_ops_s']} | "
            f"{row['variant']} | {latency} | {row['achieved_ops_s']} |"
        )
    lines += [
        "", "## Individual-run tails", "",
        "Every run with p99 at least 10 ms is repeated below so medians do not",
        "hide large tails. These are per-run percentiles, not maximum request",
        "durations. The shared-host measurements do not identify their cause.", "",
        "| Run | Channels | Offered writes/s | Variant | p50 / p95 / p99 ms | Achieved writes/s |",
        "| ---: | ---: | ---: | --- | ---: | ---: |",
    ]
    large_tails = sorted((row for row in rows if float(row["arrival_p99_ms"]) >= 10),
                         key=lambda row: float(row["arrival_p99_ms"]), reverse=True)
    for row in large_tails:
        latency = " / ".join(row[f"arrival_p{p}_ms"] for p in (50, 95, 99))
        lines.append(
            f"| {row['run']} | {row['channels']} | {row['offered_ops_s']} | "
            f"{row['variant']} | {latency} | {row['achieved_ops_s']} |"
        )
    if not large_tails:
        lines.append("No measured run had p99 at least 10 ms.")
    lines += [
        "", "The raw CSV also retains service latency, wall time and the verified",
        "zero requested/actual holds. Historical pre-timeout results remain in",
        "[channel_arrival_latency_results.md](channel_arrival_latency_results.md).",
        "See [README.md](README.md) for current and historical rerun instructions.", "",
    ]
    (args.output / "channel_deadline_arrival_latency_results.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
