#!/usr/bin/env python3
"""Summarize complete release fixed-arrival and commit-delay benchmark logs."""

import argparse
import csv
from pathlib import Path
from statistics import median


FIELDS = (
    "runtime profile mode run connections channels offered_ops_s variant n "
    "arrival_p50_ms arrival_p95_ms arrival_p99_ms service_p50_ms service_p95_ms "
    "service_p99_ms requested_hold_ms actual_hold_p50_ms actual_hold_p95_ms "
    "actual_hold_p99_ms total_wall_ms achieved_ops_s"
).split()


def read_rows(paths):
    rows = []
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.startswith("| multi_thread_16 |"):
                continue
            values = [value.strip() for value in line.strip("|").split("|")]
            assert len(values) == len(FIELDS), (path, line)
            row = dict(zip(FIELDS, values))
            assert row["profile"] == "release", row
            assert row["n"] == "2000" and row["connections"] == "16", row
            rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", type=Path, nargs=2)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    rows = read_rows(args.logs)
    groups = {}
    for row in rows:
        key = tuple(row[name] for name in (
            "mode", "channels", "offered_ops_s", "requested_hold_ms", "variant"
        ))
        groups.setdefault(key, []).append(row)
    assert len(rows) == 108 and len(groups) == 36, (len(rows), len(groups))
    for group in groups.values():
        assert sorted(row["run"] for row in group) == ["1", "2", "3"], group

    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "channel_arrival_latency_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    def value(key, field):
        return median(float(row[field]) for row in groups[key])

    def summary(key):
        return " / ".join(f"{value(key, field):.3f}" for field in (
            "arrival_p50_ms", "arrival_p95_ms", "arrival_p99_ms"
        ))

    lines = [
        "# Historical fixed-arrival and delayed-commit write results",
        "",
        "Historical source snapshot: `before` is pinned to `354da677b5`; `after` is",
        "the pre-timeout implementation at `5743b47a10`. All numbers in this report",
        "predate both the discarded per-lock limits and the total statement deadline.",
        "They are retained as baseline evidence, not current deadline measurements.",
        "Reproduce them only with the original source and benchmark harness in a separate",
        "checkout. Current below-ceiling and shared-pool evidence uses the result-recording",
        "runners described in [README.md](README.md).",
        "",
        "Release build, one local PostgreSQL 18.4 database server, sixteen Tokio",
        "workers and sixteen connections. Database files were on local tmpfs;",
        "fsync and synchronous_commit were enabled. The injected delay adds",
        "lock occupancy but does not reproduce a particular production disk.",
        "Each row compares the pinned old",
        "repository with the pre-timeout repository on the same server: three runs",
        "of 2,000 mixed writes each (500 create, edit, react and delete). Each",
        "case has 128 unmeasured warmup writes. The four operations use distinct",
        "message rows; all operations rotate through all selected channels.",
        "",
        "Table values are medians of the three per-run percentiles and achieved",
        "rates, not percentiles pooled across runs. The CSV retains every run.",
        "Latency starts at the original scheduled arrival and includes scheduler",
        "delay, the sixteen-worker admission queue, pool and counter waits, SQL,",
        "and commit acknowledgement. A fixed timer schedules every arrival",
        "independently of completions; missed ticks burst with their original",
        "timestamps. No arrival is dropped. Achieved rate is completed writes",
        "divided by wall time from first scheduled arrival through final completion.",
        "This worktree's builds, tests and query-plan jobs were idle during timing.",
        "The host was shared with other worktrees, so these local measurements",
        "are not a guarantee of production capacity or an isolated-host result.",
        "",
        "## Fixed arrivals without an injected delay",
        "",
        "| Channels | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for channels in (1, 16):
        for rate in (50, 200, 1000, 3000):
            base = ("open_loop", str(channels), str(rate), "0.000")
            old, new = (*base, "before"), (*base, "after")
            lines.append(
                f"| {channels} | {rate} | {summary(old)} | {summary(new)} | "
                f"{value(old, 'achieved_ops_s'):.1f} | {value(new, 'achieved_ops_s'):.1f} |"
            )

    lines += [
        "",
        "## Synthetic pre-commit hold in one channel",
        "",
        "Benchmark-only copies preserve each variant's ordered SQL and insert",
        "one asynchronous sleep after its final statement, immediately before",
        "COMMIT. The current copy holds the counter during that sleep; the old",
        "copy has no counter. Production code has no artificial delay or hook.",
        "Requested sleeps are minimum delays, not exact server commit latency;",
        "Tokio timer granularity and scheduling can lengthen them. The measured",
        "sleep distributions below make that difference explicit. Real commit",
        "round trips also remain in both measurements. These are sensitivity",
        "measurements, not predictions of a deployed database's capacity.",
        "",
        "| Requested hold ms | Mode | Offered writes/s | Old p50 / p95 / p99 ms | New p50 / p95 / p99 ms | Old achieved/s | New achieved/s | Old actual hold p50 / p95 ms | New actual hold p50 / p95 ms |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for hold in (2, 5):
        for rate in (None, 20, 50, 100, 200):
            mode = "closed_loop" if rate is None else "open_loop"
            rate_text = "-" if rate is None else str(rate)
            base = (mode, "1", rate_text, f"{hold:.3f}")
            old, new = (*base, "before"), (*base, "after")
            old_hold = f"{value(old, 'actual_hold_p50_ms'):.3f} / {value(old, 'actual_hold_p95_ms'):.3f}"
            new_hold = f"{value(new, 'actual_hold_p50_ms'):.3f} / {value(new, 'actual_hold_p95_ms'):.3f}"
            lines.append(
                f"| {hold} | {mode} | {rate_text} | {summary(old)} | {summary(new)} | "
                f"{value(old, 'achieved_ops_s'):.1f} | {value(new, 'achieved_ops_s'):.1f} | "
                f"{old_hold} | {new_hold} |"
            )
    lines += ["", "### Run variation near capacity", ""]
    for hold in (2, 5):
        base = ("open_loop", "1", "200", f"{hold:.3f}")
        per_variant = []
        for variant in ("before", "after"):
            per_run = sorted(groups[(*base, variant)], key=lambda row: int(row["run"]))
            per_variant.append(" / ".join(row["arrival_p95_ms"] for row in per_run))
        lines.append(
            f"At {hold} ms requested hold and 200 offered writes/s, arrival p95 in "
            f"runs 1/2/3 was {per_variant[0]} ms before and "
            f"{per_variant[1]} ms after."
        )
        lines.append("")
    lines += [
        "Open-loop samples with p99 at least 100 ms are listed explicitly,",
        "including tails below the measured saturation rate:",
        "",
        "| Hold ms | Offered writes/s | Run | Variant | p95 ms | p99 ms | Achieved writes/s |",
        "| ---: | ---: | ---: | --- | ---: | ---: | ---: |",
    ]
    for row in rows:
        if row["mode"] == "open_loop" and float(row["arrival_p99_ms"]) >= 100:
            lines.append(
                f"| {row['requested_hold_ms']} | {row['offered_ops_s']} | "
                f"{row['run']} | {row['variant']} | {row['arrival_p95_ms']} | "
                f"{row['arrival_p99_ms']} | {row['achieved_ops_s']} |"
            )
    lines += [
        "",
        "A median does not imply that every run stayed near that value. Use the",
        "per-run values and actual hold distributions when assessing tail risk.",
        "",
        "The closed-loop cases have sixteen continuously active writers and",
        "measure saturation. The open-loop cases preserve offered work even",
        "when demand exceeds the measured ceiling; a lower achieved rate and",
        "growing end-to-end latency therefore expose the backlog instead of",
        "hiding it by slowing the request generator.",
        "",
        "See [the writer-rate audit](channel_writer_rates.md) for the absence",
        "of a general per-channel rate cap, and",
        "[the transaction audit](channel_transaction_audit.md) for lock lifetime and timeout behavior.",
        "The [closed-loop repository results](channel_write_latency_results.md)",
        "retain the original per-operation saturation comparison.",
        "",
        "Reproduce the historical commands from the pre-timeout source/harness checkout",
        "(see [README.md](README.md)), then run:",
        "",
        "```sh",
        "python3 crates/messages/proofs/summarize_arrival_latency.py \\",
        "  /tmp/open-loop.log /tmp/commit-delay.log",
        "```",
        "",
    ]
    (args.output / "channel_arrival_latency_results.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
