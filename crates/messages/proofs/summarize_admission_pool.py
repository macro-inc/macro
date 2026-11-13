#!/usr/bin/env python3
"""Validate the fixed-arrival shared-pool admission proof and retain every run."""

import argparse
import csv
import math
from pathlib import Path
from statistics import median


FIELDS = (
    "proof label runtime profile run variant lane flood_rate offered_rate requested_hold_ms "
    "scheduled_seconds pool_min pool_max acquire_timeout_ms pool_size_at_start attempts "
    "admission_accepted admission_rejected successes errors pool_acquire_timeouts sqlstate_55P03 "
    "sqlstate_57014 sqlstate_40P01 other_errors arrival_p50_ms arrival_p95_ms arrival_p99_ms "
    "success_p50_ms success_p95_ms success_p99_ms rejection_arrival_p50_ms rejection_arrival_p95_ms "
    "rejection_arrival_p99_ms rejection_service_p50_ms rejection_service_p95_ms rejection_service_p99_ms "
    "actual_hold_p50_ms actual_hold_p95_ms actual_hold_p99_ms lane_wall_ms successful_ops_s attempt_ops_s"
).split()
ERRORS = ("pool_acquire_timeouts", "sqlstate_55P03", "sqlstate_57014", "sqlstate_40P01", "other_errors")


def read_rows(paths):
    rows, seen = [], set()
    for path in paths:
        for line in path.read_text().splitlines():
            if not line.startswith("admission_pool,"):
                continue
            values = next(csv.reader([line]))
            assert len(values) == len(FIELDS), (path, line)
            row = dict(zip(FIELDS, values))
            assert row["runtime"] == "multi_thread_16" and row["profile"] == "release", row
            assert row["pool_min"] == "10" and row["pool_max"] == "50", row
            assert row["acquire_timeout_ms"] == "30000" and row["pool_size_at_start"] == "50", row
            assert row["scheduled_seconds"] == "10", row
            assert row["flood_rate"] in ("1000", "3000"), row
            assert row["requested_hold_ms"] in ("0.000", "2.000", "5.000"), row
            assert row["variant"] in ("before", "after") and row["lane"] in ("flood", "neighbor"), row
            expected_rate = row["flood_rate"] if row["lane"] == "flood" else "20"
            assert row["offered_rate"] == expected_rate, row
            assert int(row["attempts"]) == int(expected_rate) * 10, row
            assert int(row["attempts"]) == int(row["admission_accepted"]) + int(row["admission_rejected"]), row
            assert int(row["attempts"]) == int(row["successes"]) + int(row["errors"]), row
            assert int(row["errors"]) == int(row["admission_rejected"]) + sum(int(row[f]) for f in ERRORS), row
            if row["variant"] == "before":
                assert row["admission_rejected"] == "0", row
            for prefix, count in (("arrival", "attempts"), ("success", "successes"),
                                  ("rejection_arrival", "admission_rejected"),
                                  ("rejection_service", "admission_rejected"),
                                  ("actual_hold", "successes")):
                samples = [row[f"{prefix}_p{p}_ms"] for p in (50, 95, 99)]
                if int(row[count]) == 0:
                    assert samples == ["NA"] * 3, row
                else:
                    numeric = [float(value) for value in samples]
                    assert all(math.isfinite(value) and value >= 0 for value in numeric), row
                    assert numeric == sorted(numeric), row
            wall = float(row["lane_wall_ms"])
            assert math.isfinite(wall) and wall > 0, row
            for field, count in (("attempt_ops_s", "attempts"), ("successful_ops_s", "successes")):
                rate = float(row[field])
                assert math.isfinite(rate) and rate >= 0, row
                assert math.isclose(rate, int(row[count]) * 1000 / wall, rel_tol=0.001, abs_tol=0.11), row
            key = tuple(row[f] for f in ("run", "flood_rate", "requested_hold_ms", "variant", "lane"))
            assert key not in seen, ("duplicate row", key)
            seen.add(key)
            rows.append(row)
    assert len({row["label"] for row in rows}) == 1, "one source label per report"
    expected = {(str(run), str(rate), hold, variant, lane)
                for run in range(1, 4) for rate in (1000, 3000) for hold in ("0.000", "2.000", "5.000")
                for variant in ("before", "after") for lane in ("flood", "neighbor")}
    assert seen == expected, ("incomplete case set", expected - seen, "unexpected", seen - expected)
    assert len(rows) == 72
    return sorted(rows, key=lambda row: (
        int(row["run"]), int(row["flood_rate"]), float(row["requested_hold_ms"]),
        row["variant"] != "before", row["lane"] != "neighbor",
    ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", type=Path, nargs="+")
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    assert args.source_revision.strip() and "\n" not in args.source_revision and "`" not in args.source_revision
    rows = read_rows(args.logs)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "channel_admission_pool_runs.csv").open("w") as output:
        writer = csv.DictWriter(output, FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    groups = {}
    for row in rows:
        key = (row["flood_rate"], row["requested_hold_ms"], row["variant"], row["lane"])
        groups.setdefault(key, []).append(row)

    def total(key, field):
        return sum(int(row[field]) for row in groups[key])

    def mid(key, field):
        values = [float(row[field]) for row in groups[key] if row[field] != "NA"]
        return f"{median(values):.3f}" if values else "NA"

    def quantiles(key, prefix):
        return " / ".join(mid(key, f"{prefix}_p{p}_ms") for p in (50, 95, 99))

    def percentage(key):
        return 100 * total(key, "admission_rejected") / total(key, "attempts")

    lines = [
        "# Fixed-arrival admission and shared-pool isolation", "",
        f"Tested implementation source: `{args.source_revision}`.",
        "The old methods are pinned to `354da677b5`. The current process admits",
        "four writes per parent and bounds admission waiting to two seconds,",
        "before pool acquisition. Idle entries are cleaned up. The database",
        "append retains a five-second lock-wait guard. The old methods bypass",
        "admission; their SQL, hydration and transaction boundaries are unchanged.", "",
        "Release profile and sixteen Tokio workers, one pool configured with",
        "minimum 10 / maximum 50 connections and its default 30-second acquire",
        "timeout. All 50 connections are opened before measurement. Each case",
        "uses two channels: 1,000 or 3,000 fixed flood arrivals per second and",
        "20 fixed neighbor arrivals per second for ten seconds, with full drain.",
        "Each write edits a distinct preseeded row, so message-row contention",
        "does not substitute for contention on the parent. Fixtures and cleanup",
        "are outside the measurement. Three runs compare old and current methods",
        "with no synthetic hold, or a requested 2 / 5 ms hold before COMMIT.", "",
        "Both arrival schedulers preserve original timestamps, including late",
        "ticks. Every request is spawned independently: there is no external",
        "semaphore or completion-dependent arrival loop. Arrival latency includes",
        "scheduler delay, gate and pool waits, SQL and commit. Rejection service",
        "time starts at the repository call; rejection arrival time includes",
        "scheduler lateness too. Rates use each lane's own time through its last",
        "completion. No request is retried or dropped.", "",
        "Admission-accepted counts mean attempts without a typed AdmissionTimeout;",
        "they can include a subsequent database failure. Successful writes mean",
        "COMMIT returned successfully. Admission rejections, database SQLSTATEs",
        "and pool-acquisition timeouts are counted separately. Missing latency",
        "samples are NA. Medians below are medians of per-run percentiles/rates;",
        "counts and fractions aggregate the three complete runs. Every raw row",
        "is retained in CSV and every neighbor run appears below.", "",
        "## Neighbor comparison", "",
        "Each variant has 600 neighbor attempts per row (200 in each run).",
        "Latency columns are p50 / p95 / p99 in milliseconds.", "",
        "| Flood/s | Hold ms | Old neighbor latency | Current neighbor latency | Old/current neighbor errors | Old/current pool timeouts |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rate in (1000, 3000):
        for hold in ("0.000", "2.000", "5.000"):
            old, new = (str(rate), hold, "before", "neighbor"), (str(rate), hold, "after", "neighbor")
            lines.append(f"| {rate} | {hold} | {quantiles(old, 'arrival')} | {quantiles(new, 'arrival')} | "
                         f"{total(old, 'errors')} / {total(new, 'errors')} | "
                         f"{total(old, 'pool_acquire_timeouts')} / {total(new, 'pool_acquire_timeouts')} |")
    lines += [
        "", "## Flood admission and completion", "",
        "Rejected percentages count only typed admission rejections. The rejection",
        "latency columns describe failed admission, not successful completion.", "",
        "| Flood/s | Hold ms | Old/current successful writes/s | Current accepted / attempted | Current rejected (%) | Rejection arrival p50 / p95 / p99 ms | Rejection service p50 / p95 / p99 ms |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rate in (1000, 3000):
        for hold in ("0.000", "2.000", "5.000"):
            old, new = (str(rate), hold, "before", "flood"), (str(rate), hold, "after", "flood")
            lines.append(f"| {rate} | {hold} | {mid(old, 'successful_ops_s')} / {mid(new, 'successful_ops_s')} | "
                         f"{total(new, 'admission_accepted')} / {total(new, 'attempts')} | "
                         f"{total(new, 'admission_rejected')} ({percentage(new):.2f}%) | "
                         f"{quantiles(new, 'rejection_arrival')} | {quantiles(new, 'rejection_service')} |")
    lines += [
        "", "## Every neighbor run", "",
        "| Run | Flood/s | Hold ms | Variant | p50 / p95 / p99 ms | Errors | Admission rejected | Pool timeout |",
        "| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        if row["lane"] == "neighbor":
            q = " / ".join(row[f"arrival_p{p}_ms"] for p in (50, 95, 99))
            lines.append(f"| {row['run']} | {row['flood_rate']} | {row['requested_hold_ms']} | {row['variant']} | "
                         f"{q} | {row['errors']} | {row['admission_rejected']} | {row['pool_acquire_timeouts']} |")
    lines += [
        "", "## Database and pool errors, every run", "",
        "| Run | Flood/s | Hold ms | Variant | Lane | Pool timeout | 55P03 | 57014 | 40P01 | Other |",
        "| ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row[field] for field in (
            "run", "flood_rate", "requested_hold_ms", "variant", "lane", *ERRORS,
        )) + " |")
    lines += [
        "", "The requested hold is a stress input, not measured production disk",
        "latency. Actual hold distributions and every admission count are in the",
        "CSV. The shared host limits causal attribution; keep these results",
        "separate from the discarded deadline and closed-loop pool experiments.",
        "See [README.md](README.md) for commands and the simultaneous-post test.", "",
    ]
    (args.output / "channel_admission_pool_results.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
