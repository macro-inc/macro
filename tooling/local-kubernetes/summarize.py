#!/usr/bin/env python3
"""Print medians only after each runtime has at least three recorded runs."""
import argparse
import json
from pathlib import Path
import statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    args = parser.parse_args()
    entries = [json.loads(line) for line in args.input.read_text().splitlines() if line.strip()]
    commits = {row['commit'] for row in entries}
    if len(commits) != 1:
        raise RuntimeError('comparison must use exactly one commit')
    labels = sorted({row['label'] for row in entries})
    groups = {}
    for label in labels:
        groups[label] = []
        for runtime in ['compose', 'kube']:
            rows = [row for row in entries if row['runtime'] == runtime and row['label'] == label]
            if len(rows) < 3:
                raise RuntimeError(f'{runtime}/{label} needs >=3 runs; found {len(rows)}')
            groups[label].append(rows)
    print('| Measurement | Compose median | Kubernetes median |')
    print('| --- | ---: | ---: |')

    def row(name, values, unit):
        print(f'| {name} | {values[0]:.3f} {unit} | {values[1]:.3f} {unit} |')

    for label, group in groups.items():
        if 'seconds' in group[0][0]:
            row(label, [statistics.median(r['seconds'] for r in runs) for runs in group], 's')
        elif 'ram_bytes' in group[0][0]:
            row(label + ' RAM', [statistics.median(r['ram_bytes'] for r in runs) / 1024**3 for runs in group], 'GiB')
            row(label + ' CPU', [statistics.median(r['cpu_cores'] for r in runs) for runs in group], 'cores')
            disk = []
            for runs in group:
                disk.append(statistics.median(
                    statistics.median(s['disk_writable_bytes'] + s.get('disk_volume_bytes', 0) for s in r['samples'])
                    for r in runs) / 1024**3)
            row(label + ' writable disk and volumes', disk, 'GiB')
        else:
            for route in group[0][0]['latency']:
                for percentile in ['p50_ms', 'p95_ms']:
                    row(f'{route} {percentile}', [statistics.median(r['latency'][route][percentile] for r in runs) for runs in group], 'ms')
    print(f"\nCommit: `{next(iter(commits))}`. Raw runs: {len(entries)}.")


if __name__ == '__main__':
    main()
