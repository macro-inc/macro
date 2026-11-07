#!/usr/bin/env python3
"""Rename Cargo packages (and dependency keys, -p flags, docs) repo-wide.

usage: rename_packages.py old=new [old=new ...]   run from the repo root.
Skips apps/web/tauri, vendor, lockfiles and the generated closure map.
"""
import os, re, subprocess, sys
ROOT = os.getcwd()
pairs = [a.split("=", 1) for a in sys.argv[1:]]
SKIP_PREFIXES = ("apps/web/tauri/", "vendor/", ".github/workspace-dep-closures.json")
SKIP_SUFFIXES = (".lock", "package-lock.json")
pat = re.compile(r"(?<![\w-])(" + "|".join(re.escape(o) for o, _ in pairs) + r")(?![\w-])")
m = dict(pairs)
n = 0
for f in subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0"):
    if not f or f.startswith(SKIP_PREFIXES) or f.endswith(SKIP_SUFFIXES) or os.path.islink(f) or not os.path.isfile(f):
        continue
    raw = open(f, "rb").read()
    if b"\0" in raw[:8192]:
        continue
    try:
        t = raw.decode()
    except UnicodeDecodeError:
        continue
    t2 = pat.sub(lambda x: m[x.group(1)], t)
    if t2 != t:
        open(f, "w").write(t2)
        n += 1
print(f"rewrote {n} files")
