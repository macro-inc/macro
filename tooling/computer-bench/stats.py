#!/usr/bin/env python3
"""p50/p95 per phase from the bench's JSON Lines files, as one markdown table.

    stats.py <file.jsonl>...

e2e runs (e2e.py, records with t_buy): seconds from Buy to each status,
t_connected, t_session and t_reply; prompt->reply, connected->session (the
lost-first-prompt resends) and session->reply; the setup trace's spans by
name; the host agent's lastLaunch phases (host:<phase>); for agent teammate
runs (--agent), Buy -> each milestone span (at:<span>); and, in older records,
the enroll-ready marker (enroll_ready, enroll_ready->connected). It also counts
runs whose first prompt was lost (resent).

Host runs (records with t_start): seconds to t_running, t_enroll_ready,
t_responsive, t_source_ready and postcopy_done; rss_kib and mem
(pss, anon, private_dirty) as MiB.

Runs with an "error" are counted, not timed.
"""

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field

Number = int | float


def percentile(values: list[Number], p: Number) -> Number:
    """Nearest-rank percentile of a nonempty list."""
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def e2e_phases(record: dict) -> dict[str, float]:
    """Seconds from Buy for one e2e run, plus derived spans and host phases."""
    base = record["t_buy"]
    out: dict[str, float] = {}
    for key, value in record.items():
        # *_created are the server's clock, so only their differences mean anything.
        if key.startswith("t_") and not key.endswith("_created") and key not in ("t_buy", "t_released") and is_number(value):
            out[key[2:]] = value - base
    if is_number(record.get("t_reply_created")) and is_number(record.get("t_prompt_created")):
        out["prompt->reply (server)"] = record["t_reply_created"] - record["t_prompt_created"]
    for start, end in (("prompt", "reply"), ("connected", "session"), ("session", "reply")):
        if is_number(record.get(f"t_{end}")) and is_number(record.get(f"t_{start}")):
            out[f"{start}->{end}"] = record[f"t_{end}"] - record[f"t_{start}"]
    marker = record.get("marker")
    if marker and is_number(record.get("clock_offset")):
        enroll_ready = marker["t"] - record["clock_offset"]
        out["enroll_ready"] = enroll_ready - base
        if is_number(record.get("t_connected")):
            out["enroll_ready->connected"] = record["t_connected"] - enroll_ready
    launch = (record.get("host_computer") or {}).get("lastLaunch") or {}
    for key, value in launch.items():
        if key.endswith("Ms") and is_number(value):
            out[f"host:{key[:-2]}"] = value / 1000
    for span in record.get("trace", []):
        out.setdefault(f"span:{span['name']}", span["end"] - span["start"])
    # Agent runs: when each milestone span began, from Buy.
    for name, span in (record.get("spans") or {}).items():
        out[f"at:{name}"] = span["start"] - base
    return out


def host_phases(record: dict) -> dict[str, float]:
    """Seconds from start and memory in MiB for one host-side run."""
    base = record["t_start"]
    out: dict[str, float] = {}
    for key in ("t_running", "t_enroll_ready", "t_responsive", "t_source_ready"):
        if is_number(record.get(key)):
            out[key[2:]] = record[key] - base
    if is_number(record.get("rss_kib")):
        out["rss_mib"] = record["rss_kib"] / 1024
    memory = record.get("mem") or {}
    for key in ("pss", "anon", "private_dirty"):
        if is_number(memory.get(f"{key}_kib")):
            out[f"{key}_mib"] = memory[f"{key}_kib"] / 1024
    if is_number(memory.get("t_postcopy_done")):
        out["postcopy_done"] = memory["t_postcopy_done"] - base
    return out


def phases(record: dict) -> dict[str, float]:
    return e2e_phases(record) if "t_buy" in record else host_phases(record)


def label_of(record: dict) -> str:
    return record.get("label") or f"{record['backend']}-{record['variant']}"


@dataclass
class Group:
    """Every phase's values for one label, and its run counts."""

    phases: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    errors: int = 0
    prompted: int = 0
    first_prompt_lost: int = 0


def summarize(records: list[dict]) -> dict[str, Group]:
    groups: dict[str, Group] = defaultdict(Group)
    for record in records:
        group = groups[label_of(record)]
        if record.get("error"):
            group.errors += 1
            continue
        if "prompt_attempts" in record:
            group.prompted += 1
            group.first_prompt_lost += record["prompt_attempts"] > 1
        for phase, value in phases(record).items():
            group.phases[phase].append(value)
    return groups


def render(groups: dict[str, Group]) -> str:
    lines = ["| backend | phase | n | p50 | p95 | min | max |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for label, group in groups.items():
        for phase, values in sorted(group.phases.items(), key=lambda item: percentile(item[1], 50)):
            in_mib = phase.endswith("_mib")
            unit = "" if in_mib else " s"
            digits = 0 if in_mib else 3
            p50, p95 = percentile(values, 50), percentile(values, 95)
            lines.append(
                f"| {label} | {phase} | {len(values)} | {p50:.{digits}f}{unit} | {p95:.{digits}f}{unit} "
                f"| {min(values):.{digits}f} | {max(values):.{digits}f} |"
            )
        if group.prompted:
            lost = f"{group.first_prompt_lost} of {group.prompted}"
            lines.append(f"| {label} | first prompt lost | {group.prompted} | {lost} | | | |")
        if group.errors:
            lines.append(f"| {label} | errors | {group.errors} | | | | |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", help="JSON Lines from e2e.py or a host-side runner")
    args = parser.parse_args()
    records = []
    for path in args.files:
        with open(path) as file:
            records.extend(json.loads(line) for line in file if line.strip())
    print(render(summarize(records)))


if __name__ == "__main__":
    main()
