#!/usr/bin/env python3
"""Validate and summarize the current-only below-ceiling write benchmark."""

import argparse
import csv
import io
import math
from pathlib import Path
from statistics import median


FIELDS = (
    "proof label runtime profile run phase mode variant writers channels offered_ops_s "
    "requested_hold_ms attempts successes errors pool_acquire_timeouts sqlstate_55P03 "
    "sqlstate_57014 sqlstate_40P01 other_errors arrival_p50_ms arrival_p95_ms arrival_p99_ms "
    "success_arrival_p50_ms success_arrival_p95_ms success_arrival_p99_ms "
    "failed_arrival_p50_ms failed_arrival_p95_ms failed_arrival_p99_ms "
    "service_p50_ms service_p95_ms service_p99_ms actual_hold_p50_ms actual_hold_p95_ms "
    "actual_hold_p99_ms total_wall_ms attempt_ops_s success_ops_s"
).split()
CASES = {("-", "0.000"), ("1000", "0.000"), ("3000", "0.000"),
         ("20", "5.000"), ("50", "5.000"), ("100", "5.000"), ("200", "2.000")}
ERROR_FIELDS = ("pool_acquire_timeouts", "sqlstate_55P03", "sqlstate_57014",
                "sqlstate_40P01", "other_errors")


def read_rows(paths):
    rows, seen = [], set()
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.startswith("bounded_latency,"):
                continue
            values = next(csv.reader(io.StringIO(line)))
            assert len(values) == len(FIELDS), (path, line)
            row = dict(zip(FIELDS, values))
            assert row["runtime"] == "multi_thread_16" and row["profile"] == "release", row
            assert row["variant"] == "after" and row["channels"] == "1", row
            assert row["phase"] in ("warmup", "measured"), row
            warmup = row["phase"] == "warmup"
            assert row["writers"] == ("1" if warmup else "16"), row
            assert row["attempts"] == ("128" if warmup else "2000"), row
            assert int(row["attempts"]) == int(row["successes"]) + int(row["errors"]), row
            assert int(row["errors"]) == sum(int(row[field]) for field in ERROR_FIELDS), row
            expected_mode = "sequential" if warmup else (
                "closed_loop" if row["offered_ops_s"] == "-" else "open_loop"
            )
            assert row["mode"] == expected_mode, row
            assert (row["offered_ops_s"], row["requested_hold_ms"]) in CASES, row
            for prefix, count in (("arrival", "attempts"), ("service", "attempts"),
                                  ("success_arrival", "successes"), ("actual_hold", "successes"),
                                  ("failed_arrival", "errors")):
                samples = [row[f"{prefix}_p{p}_ms"] for p in (50, 95, 99)]
                if int(row[count]) == 0:
                    assert samples == ["NA"] * 3, row
                else:
                    numbers = [float(value) for value in samples]
                    assert all(math.isfinite(value) and value >= 0 for value in numbers), row
                    assert numbers == sorted(numbers), row
            key = tuple(row[field] for field in (
                "label", "run", "phase", "offered_ops_s", "requested_hold_ms",
            ))
            assert key not in seen, ("duplicate case", key)
            seen.add(key)
            rows.append(row)
    labels = sorted({row["label"] for row in rows})
    assert labels, "no bounded_latency rows found"
    for label in labels:
        expected = {(label, str(run), phase, rate, hold)
                    for run in range(1, 4) for phase in ("warmup", "measured")
                    for rate, hold in CASES}
        assert expected <= seen, ("incomplete comparison", label, expected - seen)
    assert len(rows) == 42 * len(labels), len(rows)
    return sorted(rows, key=lambda row: (
        row["label"], int(row["run"]), float(row["requested_hold_ms"]),
        int(row["offered_ops_s"]) if row["offered_ops_s"] != "-" else 0,
        row["phase"] != "warmup",
    ))


def quantiles(row, prefix):
    return " / ".join(row[f"{prefix}_p{p}_ms"] for p in (50, 95, 99))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    rows = read_rows(args.logs)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "channel_bounded_latency_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    measured = [row for row in rows if row["phase"] == "measured"]
    all_errors = sum(int(row["errors"]) for row in rows)
    measured_errors = sum(int(row["errors"]) for row in measured)
    lines = [
        "# Current-repository below-ceiling write results", "",
        "Release build, sixteen Tokio workers and sixteen connections, one channel,",
        "three repetitions of 2,000 measured mixed writes per case (500 each of",
        "create, edit, react and delete). All connections are opened before timing.",
        "Each case first performs 128 separately reported sequential warmup writes.",
        "Fixture creation, warmup and cleanup are outside the measured batch.", "",
        "The `deadline50ms` label identifies a total 50 ms counter-allocation",
        "statement deadline, preserving a stricter inherited statement timeout.",
        "One preflight round trip sets it before counter acquisition; the append",
        "restores the prior setting in-statement. No-hold cases",
        "call the current repository directly. Delayed cases call the audited",
        "current-method copies with a requested 2 or 5 ms sleep after the final",
        "statement and before COMMIT. There are no automatic retries.", "",
        "Fixed arrivals retain their original timestamps independently of",
        "completion, including when they must queue for one of sixteen workers.",
        "Arrival latency includes scheduler lateness, admission and pool waits,",
        "repository execution and commit acknowledgement. Closed-loop latency",
        "starts at each repository call. Rates include draining all requests.", "",
        "Recorded environment: dedicated local PostgreSQL 18.4 with data on tmpfs,",
        "fsync and synchronous_commit enabled; this worktree's compiler, plan jobs",
        "and tests idle during timing. The host is shared with other worktrees.",
        "This synthetic hold is not a measurement of production commit latency.", "",
        f"Measured errors: **{measured_errors}**. Errors including warmup: **{all_errors}**.",
        "The no-error criterion passes only when both totals are zero. Every",
        "failed attempt remains in the latency and error counts.", "",
        "## Per-run measurements", "",
        "| Label | Run | Hold ms | Mode / offered writes/s | Successes / attempts | Errors | Arrival p50 / p95 / p99 ms | Failed p50 / p95 / p99 ms | Successful writes/s | Actual hold p50 / p95 / p99 ms |",
        "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in measured:
        lines.append(
            f"| {row['label']} | {row['run']} | {row['requested_hold_ms']} | "
            f"{row['mode']} / {row['offered_ops_s']} | {row['successes']} / {row['attempts']} | "
            f"{row['errors']} | {quantiles(row, 'arrival')} | {quantiles(row, 'failed_arrival')} | "
            f"{row['success_ops_s']} | {quantiles(row, 'actual_hold')} |"
        )
    groups = {}
    for row in measured:
        key = (row["label"], row["requested_hold_ms"], row["mode"], row["offered_ops_s"])
        groups.setdefault(key, []).append(row)

    def middle(group, field):
        values = [float(row[field]) for row in group if row[field] != "NA"]
        return f"{median(values):.3f}" if values else "NA"

    lines += [
        "", "## Three-run comparison", "",
        "Latency and rate values are medians of per-run values, not percentiles",
        "from pooled samples. Error counts are totals across all three runs.", "",
        "| Label | Hold ms | Mode / offered writes/s | Errors | Arrival p50 / p95 / p99 ms | Successful writes/s |",
        "| --- | ---: | --- | ---: | ---: | ---: |",
    ]
    for (label, hold, mode, rate), group in groups.items():
        latency = " / ".join(middle(group, f"arrival_p{p}_ms") for p in (50, 95, 99))
        errors = sum(int(row["errors"]) for row in group)
        lines.append(f"| {label} | {hold} | {mode} / {rate} | {errors} | {latency} | {middle(group, 'success_ops_s')} |")
    lines += [
        "", "## Errors, including warmup", "",
        "`55P03` includes both `Repository` and `Contended` errors; `57014` means",
        "query cancellation, `40P01` deadlock. The CSV retains successful-only",
        "arrival, all-attempt service latency, and every raw error category.", "",
        "| Label | Run | Phase | Hold ms | Offered writes/s | Pool timeout | 55P03 | 57014 | 40P01 | Other |",
        "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        values = [row[field] for field in (
            "label", "run", "phase", "requested_hold_ms", "offered_ops_s", *ERROR_FIELDS,
        )]
        lines.append("| " + " | ".join(values) + " |")
    lines += ["", "See [README.md](README.md) for the benchmark and parser commands.", ""]
    (args.output / "channel_bounded_latency_results.md").write_text("\n".join(lines))
    if all_errors:
        raise SystemExit("below-ceiling requests failed; report and CSV were written")


if __name__ == "__main__":
    main()
