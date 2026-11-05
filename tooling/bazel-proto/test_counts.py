#!/usr/bin/env python3
"""Adds up libtest's result lines across every test log under a bazel-testlogs tree."""
import os
import re
import sys

totals = {"passed": 0, "failed": 0, "ignored": 0}
binaries = 0
for base, _, files in os.walk(sys.argv[1], followlinks=True):
    if "test.log" not in files:
        continue
    binaries += 1
    text = open(os.path.join(base, "test.log"), errors="replace").read()
    for match in re.finditer(r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored", text):
        totals["passed"] += int(match.group(1))
        totals["failed"] += int(match.group(2))
        totals["ignored"] += int(match.group(3))
print("test binaries", binaries, totals)
