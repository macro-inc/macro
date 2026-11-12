#!/usr/bin/env python3
"""Validate the final release repository matrix without replacing historical evidence."""

import argparse
import csv
import math
from pathlib import Path
from statistics import median


FIELDS = (
    "runtime profile run writers channels operation variant n median_ms p95_ms "
    "p99_ms total_wall_ms throughput_ops_s"
).split()
LAYOUTS = ((1, 1), (4, 1), (16, 1), (16, 16))
OPERATIONS = ("Create", "Edit", "React", "Delete")
BASELINE_REVISION = "354da677b5"


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
            assert row["n"] == "2000", row
            layout = (int(row["writers"]), int(row["channels"]))
            assert layout in LAYOUTS, row
            assert row["operation"] in OPERATIONS and row["variant"] in ("before", "after"), row
            quantiles = [float(row[field]) for field in ("median_ms", "p95_ms", "p99_ms")]
            assert all(math.isfinite(value) and value > 0 for value in quantiles), row
            assert quantiles == sorted(quantiles), row
            wall, rate = (float(row[field]) for field in ("total_wall_ms", "throughput_ops_s"))
            assert all(math.isfinite(value) and value > 0 for value in (wall, rate)), row
            assert math.isclose(2_000_000 / wall, rate, rel_tol=0.001, abs_tol=0.11), row
            key = (int(row["run"]), *layout, row["operation"], row["variant"])
            assert key not in seen, ("duplicate result", key)
            seen.add(key)
            rows.append(row)
    expected = {(run, writers, channels, operation, variant)
                for run in range(1, 4) for writers, channels in LAYOUTS
                for operation in OPERATIONS for variant in ("before", "after")}
    assert seen == expected, ("incomplete matrix", expected - seen, "unexpected", seen - expected)
    assert len(rows) == 96
    return sorted(rows, key=lambda row: (
        int(row["run"]), LAYOUTS.index((int(row["writers"]), int(row["channels"]))),
        OPERATIONS.index(row["operation"]), row["variant"] != "before",
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
    with (args.output / "channel_deadline_write_latency_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    groups = {}
    for row in rows:
        key = (int(row["writers"]), int(row["channels"]), row["operation"], row["variant"])
        groups.setdefault(key, []).append(row)

    def value(key, field):
        return median(float(row[field]) for row in groups[key])

    def latency(key):
        return " / ".join(f"{value(key, field):.3f}" for field in ("median_ms", "p95_ms", "p99_ms"))

    def delta(old, new):
        change = new - old
        return f"{change:+.3f} ms ({100 * change / old:+.1f}%)"

    lines = [
        "# Repository write latency with a total counter deadline", "",
        f"The tested deadline implementation source is `{args.source_revision}`.",
        f"The old repository is pinned to `{BASELINE_REVISION}`, including its SQL,",
        "hydration and transaction boundaries. The current channel path adds a",
        "preflight round trip before counter acquisition to set a total 50 ms",
        "statement deadline, preserving any stricter inherited deadline. The",
        "append restores the prior setting within its own statement. These",
        "numbers compare the full old and current repository implementations;",
        "their difference is not an isolated measurement of the preflight cost.", "",
        "Release profile, sixteen Tokio workers, one dedicated local PostgreSQL",
        "18.4 server with files on tmpfs, fsync and synchronous_commit enabled.",
        "Both variants use the same database. The pool permits 32 connections;",
        "sixteen are opened before timing. This worktree's compiler, plans and",
        "other tests were idle during measurement; the host was shared with other",
        "worktrees. This is not an isolated-host or production-disk measurement.", "",
        "The complete matrix has 96 rows: three repetitions, four writer/channel",
        "layouts, four operations, and two repository variants. Every row contains",
        "2,000 successful writes after 128 unmeasured warmups. Setup, worker",
        "startup and cleanup are outside timing. This runner does not retry and",
        "fails on repository errors; it cannot discard failures and finish the",
        "matrix. The separate bounded and shared-pool runners retain error metrics.", "",
        "The tables show medians of the three per-run percentiles and throughputs,",
        "not percentiles of pooled samples. The CSV retains each run.", "",
        "## Full matrix", "",
        "All latency values are milliseconds, in p50 / p95 / p99 order.", "",
        "| Writers | Channels | Operation | Old latency ms | Current latency ms | Old writes/s | Current writes/s |",
        "| ---: | ---: | --- | ---: | ---: | ---: | ---: |",
    ]
    for writers, channels in LAYOUTS:
        for operation in OPERATIONS:
            old, new = (writers, channels, operation, "before"), (writers, channels, operation, "after")
            lines.append(
                f"| {writers} | {channels} | {operation} | {latency(old)} | {latency(new)} | "
                f"{value(old, 'throughput_ops_s'):.1f} | {value(new, 'throughput_ops_s'):.1f} |"
            )
    lines += [
        "", "## Single-writer change", "",
        "Each delta is current minus old, calculated from the medians shown above.",
        "Positive latency values mean slower writes; negative values mean faster",
        "writes. Percent changes use the old latency as the denominator.", "",
        "| Operation | p50 delta | p95 delta | p99 delta | Throughput delta |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for operation in OPERATIONS:
        old, new = (1, 1, operation, "before"), (1, 1, operation, "after")
        changes = [delta(value(old, field), value(new, field))
                   for field in ("median_ms", "p95_ms", "p99_ms")]
        old_rate, new_rate = value(old, "throughput_ops_s"), value(new, "throughput_ops_s")
        rate_delta = f"{new_rate - old_rate:+.1f} writes/s ({100 * (new_rate - old_rate) / old_rate:+.1f}%)"
        lines.append(f"| {operation} | {' | '.join(changes)} | {rate_delta} |")
    lines += [
        "", "## Every measured run", "",
        "Latency varies across repetitions on this shared host. Read these rows",
        "alongside the aggregate table before attributing a difference to the",
        "implementation. The signed deltas compare complete repository methods;",
        "they do not isolate the deadline preflight or remove host variability.", "",
        "| Run | Writers | Channels | Operation | Variant | p50 / p95 / p99 ms | Writes/s |",
        "| ---: | ---: | ---: | --- | --- | ---: | ---: |",
    ]
    for row in rows:
        latency = " / ".join(row[field] for field in ("median_ms", "p95_ms", "p99_ms"))
        lines.append(
            f"| {row['run']} | {row['writers']} | {row['channels']} | {row['operation']} | "
            f"{row['variant']} | {latency} | {row['throughput_ops_s']} |"
        )
    lines += [
        "", "This report is separate from the historical pre-timeout tables in",
        "[channel_write_latency_results.md](channel_write_latency_results.md).",
        "See [README.md](README.md) for rerun commands.", "",
    ]
    (args.output / "channel_deadline_write_latency_results.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
