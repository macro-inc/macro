#!/usr/bin/env python3
"""Move crate directories and rewrite supported resource paths to them.

usage:
  move_crates.py MAP...                 move the directories and rewrite paths
  move_crates.py --rewrite-only MAP...  only rewrite paths, for a branch that
                                        merged a move and still has old paths

A MAP file has one "old/dir new/dir" pair per line (repo-relative, `#`
comments). Run from the repository root, then `cargo x deps`.

Rust rewrites require known include/fixture/migration/manifest resource
contexts; validation and other data strings retain their exact contents.
Markdown rewrites only link destinations outside code. Other structural
config/manifest/CI/just paths retain their existing rewrite behavior.
Recorded inputs and applied migrations are excluded. See README.md for
supported contexts and the explicit-fixup workflow for other resource uses.
"""
import os
import re
import subprocess
import sys

from path_contexts import markdown_resources, rust_resources, shell_heredocs

ROOT = os.getcwd()
SKIP_PREFIXES = ("apps/web/tauri/", "vendor/", ".github/workspace-dep-closures.json", "tooling/scripts/crate_moves/", "tooling/xtask/crates/xtask_deps/src/layers/test.rs")
# Recorded data and applied migrations (sqlx checksums them): keep
# byte-identical even when they mention repo paths.
SKIP_PARTS = ("/fixtures/", "/snapshots/", "/testdata/", "/golden/", "/migrations/")
SKIP_SUFFIXES = (
    ".snap", ".sse", ".jsonl", ".har", ".lock", "package-lock.json",
    ".png", ".jpg", ".gif", ".pdf", ".woff", ".woff2", ".ttf", ".otf",
    ".wasm", ".bin", ".ico", ".zip", ".gz",
)

args = sys.argv[1:]
rewrite_only = "--rewrite-only" in args
pairs = []
for path in (a for a in args if not a.startswith("--")):
    for line in open(path):
        line = line.split("#", 1)[0].strip()
        if line:
            old, new = line.split()
            pairs.append((old.rstrip("/"), new.rstrip("/")))
pairs.sort(key=lambda p: -len(p[0]))
by_new = sorted(pairs, key=lambda p: -len(p[1]))


def newpath(p):
    for old, new in pairs:
        if p == old or p.startswith(old + "/"):
            return new + p[len(old):]
    return p


def oldpath(p):
    for old, new in by_new:
        if p == new or p.startswith(new + "/"):
            return old + p[len(new):]
    return p


def manifest_dir(f):
    """The directory of the Cargo.toml that owns file f, in today's layout."""
    d = os.path.dirname(f)
    while d and not os.path.exists(os.path.join(ROOT, d, "Cargo.toml")):
        d = os.path.dirname(d)
    return d


def new_manifest_dir(f_new):
    """The directory of the Cargo.toml that will own f_new after the move: one
    that exists there already (a crate created at the destination before the
    move, as split_hex_crate.py does) or whose pre-move location has one."""
    d = os.path.dirname(f_new)
    while d and not (
        os.path.exists(os.path.join(ROOT, d, "Cargo.toml"))
        or os.path.exists(os.path.join(ROOT, oldpath(d), "Cargo.toml"))
    ):
        d = os.path.dirname(d)
    return d


STOP = r"""[^\s"'`()\[\]<>,;:{}|]"""
# `../x` and a bare `..`; never `...` (an ellipsis) or `..Default` (Rust).
REL = re.compile(r"(?<![\w./-])((?:\.\./)+" + STOP + r"*|\.\.(?![.\w]))")
# Leading slash in concat!(env!("CARGO_MANIFEST_DIR"), "/../resource").
MANIFEST_SLASH = re.compile(r'(?<=")/((?:\.\./)*\.\.(?:/' + STOP + r"*)?)")
# `{{justfile_directory()}}/../../crates/x` in justfiles: relative to the file.
JUSTFILE_DIR = re.compile(r"(?<=\{\{justfile_directory\(\)\}\}/)((?:\.\./)*\.\.(?:/" + STOP + r"*)?)")
ROOTREL = re.compile(
    r"(?:(?<=[^\w.]\./)|(?<=^\./)|(?<=^/)|(?<=[\s!\"'`(\[]/)|(?<![\w./-]))("
    + "|".join(re.escape(o) for o, _ in pairs)
    + r")(?![\w-])",
    re.M,
)
NEW_PREFIXES = [n for _, n in pairs]


def rewrite_rel(tok, base_old, base_new):
    target = os.path.normpath(os.path.join(base_old, tok))
    if target.startswith("..") or os.path.isabs(target):
        return tok
    if target == ".":
        target = ""
    tnew = newpath(target) if target else ""
    if tnew == target and base_old == base_new:
        return tok
    rel = os.path.relpath(os.path.join(ROOT, tnew), os.path.join(ROOT, base_new))
    if tok.endswith("/") and not rel.endswith("/"):
        rel += "/"
    return rel


def rootrel(text, f=""):
    def sub(m):
        rest = text[m.start(1):]
        # `crates/email/**` in the layer config is the email group's glob,
        # even when crates/email was also a crate that moved into it.
        if f == ".config/layers.toml" and text[m.end(1):].startswith("/**"):
            return m.group(1)
        # Already in the new layout (crates/email/email when crates/email moved there).
        if rewrite_only and any(
            rest.startswith(n) and (len(rest) == len(n) or not re.match(r"[\w-]", rest[len(n)]))
            for n in NEW_PREFIXES
            if n.startswith(m.group(1) + "/")
        ):
            return m.group(1)
        return newpath(m.group(1))

    return ROOTREL.sub(sub, text)


def rewrite_token(tok, b_old, b_new):
    here = os.path.normpath(os.path.join(b_new, tok))
    if rewrite_only and os.path.exists(os.path.join(ROOT, here)):
        return tok
    if rewrite_only and not here.startswith("..") and os.path.exists(os.path.join(ROOT, newpath(here))):
        return rewrite_rel(tok, b_new, b_new)
    return rewrite_rel(tok, b_old, b_new)


def process(f, text):
    # f is where the file is now. In rewrite-only mode a moved file already
    # sits at its new path, and its stale relative paths were written for the
    # old one.
    if rewrite_only:
        f_old, f_new = oldpath(f), f
    else:
        f_old, f_new = f, newpath(f)
    # No potential rewrite means no resource interpretation is needed. This
    # also leaves unrelated unsupported syntax alone, without bypassing the
    # refusal when even one potential path needs inspection.
    if not any(pattern.search(text) for pattern in (REL, MANIFEST_SLASH, JUSTFILE_DIR, ROOTREL)):
        return False, text
    if f.endswith((".rs", ".md", ".mdx")):
        resources = rust_resources(text) if f.endswith(".rs") else markdown_resources(text)
        out = []
        cursor = 0
        for start, end, base in resources:
            value = text[start:end]
            suffix = ""
            if f.endswith((".md", ".mdx")):
                value, *tail = re.split(r"([?#].*)", value, maxsplit=1)
                suffix = "".join(tail)
            # Escaped/dynamic expressions need an explicit source fix; they
            # are not a single literal filesystem path.
            if "\\" in value or "{" in value:
                continue
            if base == "manifest":
                if rewrite_only:
                    b_new = manifest_dir(f)
                    b_old = oldpath(b_new)
                else:
                    b_old = manifest_dir(f)
                    b_new = new_manifest_dir(f_new)
            else:
                b_old, b_new = os.path.dirname(f_old), os.path.dirname(f_new)
            slash = "/" if base == "manifest" and value.startswith("/..") else ""
            tok = value[len(slash):]
            if tok == ".." or tok.startswith("../"):
                rep = rewrite_token(tok, b_old, b_new)
                rep = slash + rep
            else:
                rep = rootrel(value, f)
            out.extend((text[cursor:start], rep + suffix))
            cursor = end
        out.append(text[cursor:])
        new = "".join(out)
        return new != text, new
    if f.endswith((".sh", ".bash")):
        out = []
        cursor = 0
        for start, end in shell_heredocs(text):
            _, prefix = rewrite_lines(text[cursor:start], f, f_old, f_new)
            out.extend((prefix, text[start:end]))
            cursor = end
        _, suffix = rewrite_lines(text[cursor:], f, f_old, f_new)
        out.append(suffix)
        new = "".join(out)
        return new != text, new
    return rewrite_lines(text, f, f_old, f_new)


def rewrite_lines(text, f, f_old, f_new):
    out = []
    lines = text.splitlines(keepends=True)
    for line in lines:
        b_old, b_new = os.path.dirname(f_old), os.path.dirname(f_new)
        matches = sorted(
            list(REL.finditer(line)) + list(JUSTFILE_DIR.finditer(line)),
            key=lambda m: m.start(1),
        )
        res = []
        cursor = 0
        for m in matches:
            s, e = m.start(1), m.end(1)
            if s < cursor:
                continue
            tok = m.group(1)
            rep = rewrite_token(tok, b_old, b_new)
            res.append(rootrel(line[cursor:s], f))
            res.append(rep)
            cursor = e
        res.append(rootrel(line[cursor:], f))
        out.append("".join(res))
    new = "".join(out)
    return new != text, new


def tracked_text_files():
    for f in subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0"):
        if not f or f.startswith(SKIP_PREFIXES) or f.endswith(SKIP_SUFFIXES):
            continue
        if any(part in "/" + f for part in SKIP_PARTS):
            continue
        p = os.path.join(ROOT, f)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        raw = open(p, "rb").read()
        if b"\0" in raw[:8192]:
            continue
        try:
            yield f, raw.decode("utf-8")
        except UnicodeDecodeError:
            continue


updates = {}
for f, text in tracked_text_files():
    changed, new = process(f, text)
    if changed:
        updates[f] = new

if not rewrite_only:
    # Through a flat temporary directory, so a crate can move into a group
    # directory that shares its name (crates/email -> crates/email/email)
    # and crates nested in a moving directory move out of it first.
    tmp = ".crate_moves_tmp"
    os.makedirs(os.path.join(ROOT, tmp), exist_ok=True)
    for i, (old, _) in enumerate(pairs):
        subprocess.check_call(["git", "mv", old, f"{tmp}/{i}"], cwd=ROOT)
    # Place parent destinations first. A split can move a whole source
    # directory and then place extra modules inside it; reversing that order
    # makes git mv nest the directory under an already-created destination.
    destinations = sorted(enumerate(pairs), key=lambda entry: len(entry[1][1]))
    for i, (old, new) in destinations:
        if os.path.lexists(os.path.join(ROOT, new)):
            raise SystemExit(f"destination already exists: {new}")
        os.makedirs(os.path.dirname(os.path.join(ROOT, new)), exist_ok=True)
        subprocess.check_call(["git", "mv", f"{tmp}/{i}", new], cwd=ROOT)
    os.rmdir(os.path.join(ROOT, tmp))

for f, text in updates.items():
    dest = f if rewrite_only else newpath(f)
    with open(os.path.join(ROOT, dest), "w") as fh:
        fh.write(text)
verb = "rewrote" if rewrite_only else f"moved {len(pairs)} dirs, rewrote"
print(f"{verb} {len(updates)} files")
