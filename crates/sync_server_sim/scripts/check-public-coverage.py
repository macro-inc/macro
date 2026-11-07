#!/usr/bin/env python3
"""Require each public core function to be called by the native coverage run."""
import json
from pathlib import Path
import re
import sys

report = json.loads(Path(sys.argv[1]).read_text())
root = Path(__file__).resolve().parents[2] / "sync_server_core" / "src" / "domain"
hits = {}
for data in report["data"]:
    for function in data["functions"]:
        if not function["regions"]:
            continue
        region = function["regions"][0]
        source = Path(function["filenames"][region[5]]).resolve()
        location = (source, region[0])
        hits[location] = hits.get(location, 0) + function["count"]

public = re.compile(r"\bpub\s+(?:(?:async|const|unsafe)\s+)*fn\s+(\w+)")
missing = []
checked = 0
for source in sorted(root.rglob("*.rs")):
    if "test" in source.parts or source.name in {"test.rs", "test_support.rs"}:
        continue
    text = source.read_text()
    for match in public.finditer(text):
        first = text.count("\n", 0, match.start()) + 1
        opening = text.index("{", match.end())
        last = text.count("\n", 0, opening) + 1
        checked += 1
        if not any(hits.get((source.resolve(), line), 0) for line in range(first, last + 1)):
            missing.append(f"{source.relative_to(root)}:{first}: {match[1]}")
if missing:
    print("Uncovered public core functions:\n" + "\n".join(missing))
    sys.exit(1)
print(f"PASS: all {checked} public core functions were called by native tests/replay")
