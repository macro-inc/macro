#!/usr/bin/env python3
"""Report paths into crates/ that no longer resolve.

usage: validate_paths.py [--all]   run from the repo root

Checks, in tracked files (not apps/web/tauri, vendor, recorded test data):
  - Rust `include_str!`/`include_bytes!` and sqlx `fixtures(path = ...)`,
    resolved against the file; sqlx `migrations = ...`, `migrate!(...)` and
    `concat!(env!("CARGO_MANIFEST_DIR"), "/...")`, resolved against the
    crate's manifest directory;
  - `{{justfile_directory()}}/../x` in justfiles;
  - root-relative `crates/<a>/<b>...` strings in code, config and docs whose
    first one or two components no longer exist (globs are cut at the first
    `*`). Without --all, only paths whose directory existed at the merge base
    with origin/main are reported, so references to planned crates stay quiet.
Exits 1 if anything is broken.
"""
import os
import re
import subprocess
import sys

ROOT = os.getcwd()
SKIP_PREFIXES = (
    "apps/web/tauri/", "vendor/", ".github/workspace-dep-closures.json", "tooling/scripts/crate_moves/",
    "tooling/xtask/crates/xtask_deps/src/layers/test.rs",
)
SKIP_PARTS = ("/fixtures/", "/snapshots/", "/testdata/", "/golden/", "/migrations/", "/node_modules/")
SKIP_SUFFIXES = (".snap", ".sse", ".jsonl", ".har", ".lock", "package-lock.json")


def manifest_dir(f):
    d = os.path.dirname(f)
    while d and not os.path.exists(os.path.join(ROOT, d, "Cargo.toml")):
        d = os.path.dirname(d)
    return d


def exists(base, rel):
    return os.path.exists(os.path.normpath(os.path.join(ROOT, base, rel)))


FILE_REL = re.compile(r'(?:include_str|include_bytes)!\(\s*"([^"]+)"|fixtures\(\s*path\s*=\s*"([^"]+)"')
MANIFEST_REL = re.compile(r'migrations\s*=\s*"([^"]+)"|migrate!\(\s*"([^"]+)"')
CONCAT = re.compile(r'concat!\(\s*env!\("CARGO_MANIFEST_DIR"\)\s*,\s*"(/[^"]+)"', re.S)
JUST = re.compile(r"\{\{justfile_directory\(\)\}\}/((?:\.\./)+[^\s\"'`]+)")
ROOTREL = re.compile(r"(?:(?<=^/)|(?<=[\s!\"'`(\[]/)|(?<![\w./-]))crates/([\w-]+)(?:/([\w-]+))?", re.M)

files = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
base_dirs = None
if "--all" not in sys.argv:
    mb = subprocess.check_output(["git", "merge-base", "HEAD", "origin/main"]).decode().strip()
    listing = subprocess.check_output(["git", "ls-tree", "-d", "--name-only", "-r", mb, "crates"]).decode().split("\n")
    base_dirs = set(listing)

broken = []
for f in files:
    if not f or f.startswith(SKIP_PREFIXES) or f.endswith(SKIP_SUFFIXES) or any(p in "/" + f for p in SKIP_PARTS):
        continue
    p = os.path.join(ROOT, f)
    if os.path.islink(p) or not os.path.isfile(p):
        continue
    raw = open(p, "rb").read()
    if b"\0" in raw[:8192]:
        continue
    try:
        text = raw.decode()
    except UnicodeDecodeError:
        continue
    if f.endswith(".rs"):
        for m in FILE_REL.finditer(text):
            rel = m.group(1) or m.group(2)
            if rel.startswith("..") and not exists(os.path.dirname(f), rel):
                broken.append((f, rel, "file-relative"))
        for m in MANIFEST_REL.finditer(text):
            rel = m.group(1) or m.group(2)
            if not exists(manifest_dir(f), rel):
                broken.append((f, rel, "manifest-relative"))
        for m in CONCAT.finditer(text):
            rel = m.group(1).lstrip("/")
            # Only paths that leave the crate; others are often outputs.
            if rel.startswith("..") and not exists(manifest_dir(f), rel):
                broken.append((f, m.group(1), "CARGO_MANIFEST_DIR"))
        # `Path::new(env!("CARGO_MANIFEST_DIR"))` then `.parent()` and
        # `.join("../x")` calls, possibly across lines.
        for m in re.finditer(r'env!\("CARGO_MANIFEST_DIR"\)\)((?:\s*\.(?:parent\(\)(?:\.unwrap\(\)|\.expect\([^)]*\))?|join\("[^"]*"\)))+)', text):
            base = manifest_dir(f)
            parts = re.findall(r'(parent)\(\)|join\("([^"]*)"\)', m.group(1))
            cur = base
            for par, j in parts:
                cur = os.path.dirname(cur) if par else os.path.normpath(os.path.join(cur, j))
            leaves = any(par for par, _ in parts) or any(j.startswith("..") for _, j in parts)
            if leaves and not os.path.exists(os.path.join(ROOT, cur)) and not os.path.exists(os.path.join(ROOT, os.path.dirname(cur))):
                broken.append((f, m.group(1).strip().replace("\n", " "), "CARGO_MANIFEST_DIR chain"))
    if os.path.basename(f) in ("justfile",) or f.endswith(".just"):
        for m in JUST.finditer(text):
            rel = m.group(1)
            if "{{" in rel or "crates/" not in rel:
                continue
            if not exists(os.path.dirname(f), rel):
                broken.append((f, rel, "justfile_directory"))
    for m in ROOTREL.finditer(text):
        a, b = m.group(1), m.group(2)
        one = f"crates/{a}"
        two = f"{one}/{b}" if b else None
        if os.path.exists(os.path.join(ROOT, one)):
            # crates/<group> exists; check the crate under it when it names one.
            if two and os.path.isdir(os.path.join(ROOT, one)) and not os.path.exists(os.path.join(ROOT, one, "Cargo.toml")):
                if not os.path.exists(os.path.join(ROOT, two)) and (base_dirs is None or two in base_dirs):
                    broken.append((f, two, "root-relative"))
            continue
        if base_dirs is None or one in base_dirs:
            broken.append((f, one, "root-relative"))

for f, rel, kind in sorted(set(broken)):
    print(f"{f}: {rel} ({kind})")
print(f"{len(set(broken))} broken path(s)", file=sys.stderr)
sys.exit(1 if broken else 0)
