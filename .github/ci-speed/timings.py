#!/usr/bin/env python3
"""Prints the slowest cargo units from a cargo-timing.html as RESULT lines."""
import json, re, sys
html = open(sys.argv[1]).read()
m = re.search(r'const UNIT_DATA = (\[.*?\]);\n', html, re.S)
units = json.loads(m.group(1))
tot = max(u['start'] + u['duration'] for u in units)
print(f"UNITS count={len(units)} span={tot:.0f}s")
for u in sorted(units, key=lambda u: -u['duration'])[:8]:
    print(f"UNIT {u['name']} {u.get('target','')} start={u['start']:.0f} dur={u['duration']:.1f} rmeta={u.get('rmeta_time') or 0:.1f}")
