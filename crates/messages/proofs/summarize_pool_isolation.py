#!/usr/bin/env python3
"""Validate and summarize complete shared-pool isolation benchmark logs."""

import argparse
import csv
import io
import math
from pathlib import Path
from statistics import median


OLD_FIELDS = (
    "proof label runtime profile run variant lane flood_writers offered_ops_s "
    "pool_min pool_max acquire_timeout_ms pool_size_at_start measured_seconds "
    "wall_with_drain_seconds attempts successes errors pool_acquire_timeouts "
    "sqlstate_55P03 sqlstate_57014 sqlstate_40P01 other_errors attempt_p50_ms "
    "attempt_p95_ms attempt_p99_ms success_p50_ms success_p95_ms success_p99_ms "
    "requested_hold_ms success_hold_p50_ms success_hold_p95_ms success_hold_p99_ms "
    "success_ops_s"
).split()
FIELDS = OLD_FIELDS + ["failed_p50_ms", "failed_p95_ms", "failed_p99_ms"]


def read_rows(paths, expected_seconds, partial_counterexample=False):
    rows = []
    seen = set()
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.startswith("pool_isolation,"):
                continue
            values = next(csv.reader(io.StringIO(line)))
            legacy = len(values) == len(OLD_FIELDS)
            assert legacy or len(values) == len(FIELDS), (path, line)
            row = dict(zip(FIELDS, values))
            if legacy:
                row.update({field: "NA" for field in FIELDS[len(OLD_FIELDS):]})
            assert row["runtime"] == "multi_thread_16", row
            assert row["profile"] == "release", row
            assert row["pool_min"] == "10" and row["pool_max"] == "50", row
            assert row["pool_size_at_start"] == "50", row
            assert row["acquire_timeout_ms"] == "30000", row
            assert row["flood_writers"] == "100", row
            assert row["requested_hold_ms"] == "5", row
            assert float(row["measured_seconds"]) == expected_seconds, row
            assert int(row["attempts"]) == int(row["successes"]) + int(row["errors"]), row
            assert int(row["errors"]) == sum(int(row[field]) for field in (
                "pool_acquire_timeouts", "sqlstate_55P03", "sqlstate_57014",
                "sqlstate_40P01", "other_errors",
            )), row
            for prefix, count in (("attempt", "attempts"), ("success", "successes"),
                                  ("success_hold", "successes"), ("failed", "errors")):
                if prefix == "failed" and legacy:
                    continue
                samples = [row[f"{prefix}_p{p}_ms"] for p in (50, 95, 99)]
                if int(row[count]) == 0:
                    assert samples == ["NA"] * 3, row
                else:
                    values_ms = [float(value) for value in samples]
                    assert all(math.isfinite(value) and value >= 0 for value in values_ms), row
                    assert values_ms == sorted(values_ms), row
            if row["lane"] == "probe":
                assert int(row["attempts"]) == expected_seconds * 5, row
                assert row["offered_ops_s"] == "5", row
            else:
                assert row["lane"] == "flood" and row["offered_ops_s"] == "closed_loop", row
            key = tuple(row[field] for field in ("label", "run", "variant", "lane"))
            assert key not in seen, ("duplicate case", key)
            seen.add(key)
            rows.append(row)
    labels = sorted({row["label"] for row in rows})
    assert labels, "no pool_isolation CSV rows found"
    for label in labels:
        expected = {
            (label, str(run), variant, lane)
            for run in range(1, 4)
            for variant in ("before", "after")
            for lane in ("flood", "probe")
        }
        if partial_counterexample:
            assert labels == ["bounded50ms"], "partial mode is reserved for the discarded per-lock counterexample"
            completed = {(label, str(run), variant, lane)
                         for variant, runs in (("before", range(1, 4)), ("after", range(1, 3)))
                         for run in runs for lane in ("flood", "probe")}
            assert seen == completed, ("expected three old and two current completed cases", seen)
            assert seen < expected
        else:
            assert expected <= seen, ("incomplete three-run comparison", label, expected - seen)
    if not partial_counterexample:
        assert len(rows) == len(labels) * 12, ("unexpected cases", len(rows))
    return sorted(rows, key=lambda row: (
        row["label"], int(row["run"]), row["variant"] != "before", row["lane"] != "probe",
    ))


def quantiles(row, prefix):
    return " / ".join(row[f"{prefix}_p{percentile}_ms"] for percentile in (50, 95, 99))



def source_context(rows):
    labels = sorted({row["label"] for row in rows})
    known_sources = {
        "baseline": (
            "Pre-timeout implementation at `5743b47a10`, plus the shared-pool "
            "benchmark harness."
        ),
        "bounded5ms": (
            "Implementation with the transaction-local 5 ms counter lock-wait "
            "timeout, retaining any stricter nonzero inherited timeout."
        ),
        "bounded50ms": (
            "Discarded per-lock 50 ms timeout; consecutive transaction-id lock "
            "waits can exceed 50 ms in total. This did not isolate the shared pool."
        ),
        "deadline50ms": (
            "Total 50 ms counter-allocation statement deadline, preserving a "
            "stricter inherited statement timeout. One preflight round trip sets "
            "the deadline before allocation; the append restores it in-statement."
        ),
    }
    lines = [
        "## Source and environment", "",
        "The `before` variant always uses the old repository methods pinned to",
        "`354da677b5`, including their original hydration path. The `after`",
        "variant uses the source state identified by its label:", "",
        "| Label | Current-method source |", "| --- | --- |",
    ]
    for label in labels:
        lines.append(f"| {label} | {known_sources.get(label, 'Source state not recorded by this parser.')} |")
    lines += [
        "", "The benchmark-only method copies preserve the ordered SQL and add only",
        "the measured sleep and returned duration; verify them with",
        "[the source-equivalence audit](check_delayed_writers.py). Requests call",
        "the repository directly and have no automatic retries. Each error is",
        "one failed request, not a successfully retried operation.", "",
        "Pool sizing copies the production branch in",
        "[the document storage server](../../../services/document_storage_service/src/server.rs#L245):",
        "minimum 10, maximum 50, with SQLx's default 30-second acquire timeout.",
        "The recorded benchmark settings are checked against those values.", "",
    ]
    if any(label in known_sources for label in labels):
        lines += [
            "Recorded environment for the `baseline`, `bounded5ms`, `bounded50ms` and `deadline50ms` measurements:",
            "a dedicated local PostgreSQL 18.4 server with data files on tmpfs,",
            "`fsync` and `synchronous_commit` enabled. This worktree's compiler,",
            "query-plan jobs and tests were idle during the timed work. The host",
            "was shared with other worktrees; this was not an isolated-host or",
            "production-disk measurement. These facts are recorded context, not",
            "settings inferred by the parser from the CSV.", "",
        ]
    return lines

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    parser.add_argument("--expected-seconds", type=int, default=30)
    parser.add_argument("--partial-counterexample", action="store_true",
                        help="retain the incomplete bounded50ms run separately, without a three-run summary")
    args = parser.parse_args()
    assert args.expected_seconds > 0
    rows = read_rows(args.logs, args.expected_seconds, args.partial_counterexample)
    stem = ("channel_pool_isolation_bounded50ms_partial" if args.partial_counterexample
            else "channel_pool_isolation")
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / f"{stem}_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    notice = []
    if args.partial_counterexample:
        notice = [
            "**Incomplete counterexample, not the required three-run proof.**",
            "This per-lock timeout experiment was stopped after three old-method",
            "cases and two new-method cases. The rows below are only the completed",
            "cases. There is no third new-method result or three-run aggregate.", "",
        ]
        probes = [row for row in rows if row["variant"] == "after" and row["lane"] == "probe"]
        probe_p95 = " / ".join(row["attempt_p95_ms"] for row in probes)
        errors = sum(int(row["errors"]) for row in probes)
        notice += [
            f"The completed new-method probe runs had p95 **{probe_p95} ms** and",
            f"**{errors} errors** across {sum(int(row['attempts']) for row in probes)} probes.",
            "The absence of errors did not establish latency isolation: a per-lock",
            "timeout can restart across successive transaction-id lock waits.",
            "This counterexample motivated the total statement deadline.", "",
        ]
    lines = ["# Shared-pool channel isolation results", ""] + notice + source_context(rows) + [
        "## Workload", "",
        "Release build with sixteen Tokio workers, a shared pool of 10 minimum /",
        "50 maximum connections, and the default 30-second acquire timeout.",
        "All 50 connections were opened before measurement. One hundred writers",
        "each edit a distinct message in the flood channel; independent probes",
        "edit distinct messages in a second channel at five scheduled arrivals",
        "per second. Both repository variants receive a requested 5 ms sleep",
        "after their last SQL statement and before COMMIT. The current variant",
        "holds its channel counter during this artificial interval.", "",
        f"Each case admits work for {args.expected_seconds} seconds and retains all",
        f"{args.expected_seconds * 5} scheduled probes. Probe latency starts at the",
        "original scheduled arrival and includes pool waits; flood latency starts",
        "at each repository call. No semaphore precedes the pool. Throughput",
        "includes draining in-flight work. Setup and cleanup are not timed.", "",
        "Each row below is one run, not an aggregate of percentiles. Attempt",
        "latency includes failed writes. Successful-write latency and observed",
        "sleep duration exclude errors; NA means there were no successful writes.",
        "The sleep is a controlled stress input, not a measured production commit",
        "latency.", "",
        "| Label | Run | Variant | Lane | Attempts / successes | Attempt p50 / p95 / p99 ms | Success p50 / p95 / p99 ms | Successes/s | Observed 5 ms hold p50 / p95 / p99 ms |",
        "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        lines.append(
            f"| {row['label']} | {row['run']} | {row['variant']} | {row['lane']} | "
            f"{row['attempts']} / {row['successes']} | {quantiles(row, 'attempt')} | "
            f"{quantiles(row, 'success')} | {row['success_ops_s']} | "
            f"{quantiles(row, 'success_hold')} |"
        )
    groups = {}
    for row in rows:
        groups.setdefault((row["label"], row["variant"], row["lane"]), []).append(row)

    def middle(group, field):
        values = [float(row[field]) for row in group if row[field] != "NA"]
        return f"{median(values):.3f}" if values else "NA"

    def middle_quantiles(group, prefix):
        return " / ".join(middle(group, f"{prefix}_p{p}_ms") for p in (50, 95, 99))

    def total(group, field):
        return sum(int(row[field]) for row in group)

    if not args.partial_counterexample:
        lines += [
            "", "## Three-run comparison", "",
            "Latency and rate columns below are medians of the three per-run values,",
            "not percentiles calculated from pooled samples. Error columns are sums",
            "over all three runs. Failure percentages use total errors divided by",
            "total attempts. The per-run tables retain tail variation.", "",
            "| Label | Variant | Probe attempts | Probe p50 / p95 / p99 ms | Probe errors / pool timeouts / 55P03 | Failed % | Failed p50 / p95 / p99 ms | Probe observed hold p50 / p95 / p99 ms |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for (label, variant, lane), group in groups.items():
            if lane == "probe":
                lines.append(
                    f"| {label} | {variant} | {total(group, 'attempts')} | "
                    f"{middle_quantiles(group, 'attempt')} | {total(group, 'errors')} / "
                    f"{total(group, 'pool_acquire_timeouts')} / {total(group, 'sqlstate_55P03')} | "
                    f"{100 * total(group, 'errors') / total(group, 'attempts'):.2f}% | "
                    f"{middle_quantiles(group, 'failed')} | {middle_quantiles(group, 'success_hold')} |"
                )
        lines += [
            "", "| Label | Variant | Flood successes/s | Flood p50 / p95 / p99 ms | Flood errors / pool timeouts / 55P03 | Failed % | Failed p50 / p95 / p99 ms | Flood observed hold p50 / p95 / p99 ms |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for (label, variant, lane), group in groups.items():
            if lane == "flood":
                lines.append(
                    f"| {label} | {variant} | {middle(group, 'success_ops_s')} | "
                    f"{middle_quantiles(group, 'attempt')} | {total(group, 'errors')} / "
                    f"{total(group, 'pool_acquire_timeouts')} / {total(group, 'sqlstate_55P03')} | "
                    f"{100 * total(group, 'errors') / total(group, 'attempts'):.2f}% | "
                    f"{middle_quantiles(group, 'failed')} | {middle_quantiles(group, 'success_hold')} |"
                )
    lines += [
        "", "## Errors", "",
        "The `55P03` count includes the preserved SQLSTATE in both",
        "`MessageError::Repository` and `MessageError::Contended`. The classifier",
        "likewise counts underlying `57014` statement cancellations separately;",
        "the domain variant does not hide the original PostgreSQL error code.",
        "Failed-attempt latency is retained separately from successful writes.",
        "Legacy 34-column logs have no failed-latency samples and show `NA` for",
        "that field, even if they contain failures. Current logs have 37 columns.",
        "A failure percentage is calculated from errors divided by all attempts;",
        "it does not discard failed requests from the denominator.",
        "These direct repository measurements do not exercise HTTP responses;",
        "the 503 and `Retry-After: 1` mapping is described separately in the",
        "[transaction and timeout audit](channel_transaction_audit.md#caller-visible-failures-and-rollback).", "",
        "| Label | Run | Variant | Lane | All errors | Failed % | Failed p50 / p95 / p99 ms | Pool acquire timeout | 55P03 | 57014 | 40P01 | Other |",
        "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        values = [row[field] for field in ("label", "run", "variant", "lane", "errors")]
        values += [f"{100 * int(row['errors']) / int(row['attempts']):.2f}%", quantiles(row, "failed")]
        values += [row[field] for field in (
            "pool_acquire_timeouts", "sqlstate_55P03", "sqlstate_57014", "sqlstate_40P01", "other_errors",
        )]
        lines.append("| " + " | ".join(values) + " |")
    lines += [
        "", "The CSV retains pool settings, full wall time and all per-run fields.",
        "Reproduce the benchmark and parsing commands in [README.md](README.md).", "",
    ]
    (args.output / f"{stem}_results.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
