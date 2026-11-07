#!/usr/bin/env python3
"""Rename a workspace crate: directory, package, lib name and every user.

usage: rename_crate.py [--words] OLD NEW   (package names; run from the repo root)

--words: the old name is distinctive (`ai_engine`, not `model`), so also
replace every whole-word mention in docs, comments, scripts and config.

1. Moves the crate directory to a sibling named NEW and rewrites paths to it
   (with move_crates.py).
2. Renames the package in its Cargo.toml and in every manifest: dependency
   keys (`old = ...`, `old.workspace = true`, `[dependencies.old]`),
   `features` entries (`old/x`, `dep:old`, `old?/x`) and `package = "old"`.
3. Renames the crate in the Rust sources of the crate and its dependents:
   `use old::`, `::old::`, `extern crate old` everywhere; `old::` at the start
   of a path and `old!` outside `use` statements, unless the file declares or
   imports its own item called `old` (those files are listed for review).
4. Renames insta snapshot files (`old__*.snap`) in the crate.
5. Rewrites `-p old`, `--package old` and `package(old)` in scripts,
   workflows, justfiles and docs, and `"old"` in .config/hakari.toml, the
   nextest determinator and .github/services-config.json.
6. Lists `RUST_LOG`-style filters that name the old crate: tracing targets
   follow the crate name, so update them by hand.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.getcwd()
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
WORDS = "--words" in sys.argv
OLD, NEW = ARGS[0], ARGS[1]
HERE = os.path.dirname(os.path.abspath(__file__))

meta = json.loads(
    subprocess.check_output(
        ["cargo", "metadata", "--no-deps", "--format-version", "1", "--offline"], stderr=subprocess.DEVNULL
    )
)
pkg = next(p for p in meta["packages"] if p["name"] == OLD)
crate_dir = os.path.relpath(os.path.dirname(pkg["manifest_path"]), ROOT)
libs = [t for t in pkg["targets"] if set(t["kind"]) & {"lib", "rlib", "cdylib", "proc-macro"}]
OLD_LIB = libs[0]["name"] if libs else OLD.replace("-", "_")
NEW_LIB = NEW.replace("-", "_")
dependents = []
for p in meta["packages"]:
    for d in p["dependencies"]:
        if d["name"] == OLD and d.get("path"):
            dependents.append((p, d.get("rename")))
            break

new_dir = os.path.join(os.path.dirname(crate_dir), NEW)
if os.path.basename(crate_dir) != NEW:
    m = os.path.join("/tmp", f"rename-{OLD}.map")
    with open(m, "w") as fh:
        fh.write(f"{crate_dir} {new_dir}\n")
    subprocess.check_call([sys.executable, os.path.join(HERE, "move_crates.py"), m])
else:
    new_dir = crate_dir

changed = set()


def rewrite(path, fn):
    text = open(path).read()
    new = fn(text)
    if new != text:
        open(path, "w").write(new)
        changed.add(path)


def apply(rules, text):
    for rx, rep in rules:
        text = rx.sub(rep, text)
    return text


# Manifests.
O = re.escape(OLD)
manifest_rules = [
    (re.compile(r"^(\s*)" + O + r"(\s*=|\.workspace\s*=)", re.M), r"\g<1>" + NEW + r"\2"),
    (re.compile(r"^\[(.*dependencies)\." + O + r"\]", re.M), r"[\1." + NEW + "]"),
    (re.compile(r'"(dep:)?' + O + r"(\??/)"), r'"\1' + NEW + r"\2"),
    (re.compile(r'"dep:' + O + r'"'), '"dep:' + NEW + '"'),
    (re.compile(r'(\bpackage\s*=\s*")' + O + r'"'), r"\g<1>" + NEW + '"'),
]
SECTION = re.compile(r"^\[[^\]]*\]", re.M)


def rename_manifest(text):
    """Dependency keys only inside dependency tables; a feature may share
    the crate's name (`ai_tools = ["dep:..."]`). An optional dependency is
    also an implicit feature (`convert = ["old"]`) unless the manifest
    defines a feature with that name or names the dependency as `dep:old`."""
    optional = re.search(r"^\s*" + O + r"\s*=\s*\{[^}\n]*optional\s*=\s*true", text, re.M)
    feature = re.search(r"^\[features\][^\[]*^\s*" + O + r"\s*=", text, re.M | re.S)
    if optional and not feature and '"dep:' + OLD + '"' not in text:
        m = re.search(r"^\[features\]\n(.*?)(?=^\[|\Z)", text, re.M | re.S)
        if m:
            body = re.sub(r'(?<=[\[,\s])"' + O + r'"(?=\s*[,\]])', '"' + NEW + '"', m.group(1))
            text = text[:m.start(1)] + body + text[m.end(1):]
    out, last, deps = [], 0, False
    for m in SECTION.finditer(text):
        chunk = text[last:m.start()]
        out.append(apply(manifest_rules, chunk) if deps else apply(manifest_rules[1:], chunk))
        header = m.group(0)
        deps = "dependencies" in header and not re.search(r"dependencies\.", header)
        out.append(apply(manifest_rules[1:2], header))
        last = m.end()
    chunk = text[last:]
    out.append(apply(manifest_rules, chunk) if deps else apply(manifest_rules[1:], chunk))
    return "".join(out)


for f in subprocess.check_output(["git", "ls-files", "*Cargo.toml"]).decode().split():
    if not f.startswith(("apps/web/tauri/", "vendor/")) and os.path.exists(f):
        rewrite(f, rename_manifest)
rewrite(
    os.path.join(new_dir, "Cargo.toml"),
    lambda t: re.sub(r'^(name\s*=\s*")' + O + r'"', r"\g<1>" + NEW + '"', t, count=1, flags=re.M),
)

# Rust sources.
L, NL = re.escape(OLD_LIB), NEW_LIB
unambiguous = [
    # A `use` statement, not the word "use" in prose.
    (re.compile(r"^(\s*(?:pub(?:\([\w:]+\))?\s+)?use\s+(?:::)?)" + L + r"\b", re.M), r"\g<1>" + NL),
    (re.compile(r"(?<![\w:])::" + L + r"::"), "::" + NL + "::"),
    (re.compile(r"\bextern\s+crate\s+" + L + r"\b"), "extern crate " + NL),
]
ambiguous = [
    (re.compile(r"(?<![\w:.$])" + L + r"(::)"), NL + r"\1"),
    (re.compile(r"(?<![\w:.$])" + L + r"(!)"), NL + r"\1"),
]
local_decl = re.compile(
    # Only names that can start a path: modules, types, imports. A `let`,
    # `fn` or field called `old` cannot.
    r"\b(?:mod|struct|enum|trait|type|union)\s+" + L + r"\b"
    r"|\buse\s+[^;]*(?:::|\{|,)\s*" + L + r"\s*[;,}]"
    r"|\bas\s+" + L + r"\b"
)
# A `use` statement starts its line; "use" in prose is not one.
USE_STMT = re.compile(r"^\s*(?:pub(?:\([\w:]+\))?\s+)?use\s[^;]*;", re.M | re.S)
COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
DOC_LINE = re.compile(r"^\s*//[/!].*$", re.M)


def outside_use(text, fn):
    """Apply fn between `use ...;` statements: inside a use tree, `{old::x}`
    is a path under the tree's root, not the crate."""
    out, last = [], 0
    for m in USE_STMT.finditer(text):
        out.append(fn(text[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(fn(text[last:]))
    return "".join(out)


review = []
src_dirs = [new_dir] + [
    os.path.relpath(os.path.dirname(p["manifest_path"]), ROOT) for p, rename in dependents if rename is None
]
for d in src_dirs:
    for f in subprocess.check_output(["git", "ls-files", "--", f"{d}/*.rs", f"{d}/**/*.rs"]).decode().split():
        if not os.path.exists(f):
            continue
        t = open(f).read()
        # The crate's library never names itself (a `use old::` there is a
        # local module); its bins, tests, benches and examples do.
        rel = os.path.relpath(f, d)
        in_lib = d == new_dir and not rel.startswith(("src/bin/", "tests/", "benches/", "examples/"))
        local = in_lib or local_decl.search(COMMENTS.sub("", t))
        n = t if local else apply(unambiguous, t)
        if local and not in_lib and any(rx.search(outside_use(n, lambda s: s)) for rx, _ in ambiguous):
            review.append(f)
        if not local:
            n = outside_use(n, lambda seg: apply(ambiguous, seg))
        elif in_lib:
            # Doc tests compile outside the crate and name it.
            n = DOC_LINE.sub(lambda m: apply(ambiguous, m.group(0)), n)
        if n != t:
            open(f, "w").write(n)
            changed.add(f)

# A dependent that re-exports the crate (`pub use old;`) exposes it as a
# module, `crate::old` inside and `<dependent>::old` outside.
reexporters = []
for p, rename in dependents:
    if rename is not None:
        continue
    d = os.path.relpath(os.path.dirname(p["manifest_path"]), ROOT)
    libs_d = [t["name"] for t in p["targets"] if set(t["kind"]) & {"lib", "rlib", "cdylib"}]
    for f in subprocess.check_output(["git", "ls-files", "--", f"{d}/src/lib.rs"]).decode().split():
        if re.search(r"\bpub\s+use\s+" + re.escape(NL) + r"\s*;", open(f).read()):
            reexporters.append((d, libs_d[0] if libs_d else None))
for d, dep_lib in reexporters:
    for f in subprocess.check_output(["git", "ls-files", "--", f"{d}/*.rs", f"{d}/**/*.rs"]).decode().split():
        rewrite(f, lambda t: re.sub(r"\bcrate::" + L + r"\b", "crate::" + NL, t))
    if dep_lib:
        for f in subprocess.check_output(["git", "ls-files", "*.rs"]).decode().split():
            if os.path.exists(f) and not f.startswith(("vendor/", "apps/web/tauri/")):
                rewrite(f, lambda t: re.sub(r"\b" + re.escape(dep_lib) + r"::" + L + r"\b", dep_lib + "::" + NL, t))

# A distinctive name (--words) cannot be a local item, so every `old::` in
# Rust code names the crate or a re-export of it (`{old::X}` in a use tree
# under `macro_user_id::` or `crate::`).
if WORDS:
    for f in subprocess.check_output(["git", "ls-files", "*.rs"]).decode().split():
        if os.path.exists(f) and not f.startswith(("vendor/", "apps/web/tauri/")):
            rewrite(f, lambda t: re.sub(r"(?<![\w$])" + L + r"(::|!)", NL + r"\1", t))

# insta snapshots.
for f in subprocess.check_output(["git", "ls-files", "--", new_dir]).decode().split():
    b = os.path.basename(f)
    if b.endswith(".snap") and b.startswith(OLD_LIB + "__"):
        subprocess.check_call(["git", "mv", f, os.path.join(os.path.dirname(f), NEW_LIB + b[len(OLD_LIB):])])

# Whole-word mentions (--words): Markdown, comment lines, and wasm-pack's
# output file names (`old.js`, `old_bg.wasm`). Never code or string
# literals: a field, span or tool called `old` is not the crate.
WORD = re.compile(r"(?<![\w-])" + re.escape(OLD_LIB) + r"(?![\w-]|\.[a-z_])")
WASM_FILE = re.compile(r"(?<![\w-])" + re.escape(OLD_LIB) + r"(?=(?:_bg)?\.(?:js|wasm|d\.ts)\b)")
COMMENT = re.compile(r"^(\s*(?://+!?|#|\*|/\*+|--)\s?)(.*)$", re.M)


def rename_words(f, text):
    text = WASM_FILE.sub(NEW_LIB, text)
    if f.endswith((".md", ".mdx")):
        return WORD.sub(NEW_LIB, text)
    return COMMENT.sub(lambda m: m.group(1) + WORD.sub(NEW_LIB, m.group(2)), text)


# Package selectors in scripts, CI and docs; package lists in config.
selectors = [
    (re.compile(r"(\s-p\s*)" + O + r"(?![\w-])"), r"\g<1>" + NEW),
    (re.compile(r"(--package[\s=]+)" + O + r"(?![\w-])"), r"\g<1>" + NEW),
    (re.compile(r"(package\()" + O + r"(\))"), r"\g<1>" + NEW + r"\2"),
]
lists = {
    ".config/hakari.toml",
    "tooling/xtask/crates/xtask_nextest_filter/determinator.toml",
    ".github/services-config.json",
}
for f in subprocess.check_output(["git", "ls-files"]).decode().split():
    if f.startswith(("apps/web/tauri/", "vendor/", "tooling/scripts/crate_moves/")):
        continue
    if not os.path.isfile(f) or os.path.islink(f) or "/fixtures/" in f or "/snapshots/" in f:
        continue
    if f.endswith(".lock") or f == ".github/workspace-dep-closures.json":
        continue
    if not re.search(r"(\.(sh|just|yml|yaml|md|mdx|rs|ts|tsx|js|mjs|toml|json|jsonc|py|nix|ps1)|justfile|\.gitignore)$", f):
        continue
    try:
        t = open(f).read()
    except UnicodeDecodeError:
        continue
    n = apply(selectors, t)
    if WORDS:
        n = rename_words(f, n)
    if f in lists:
        n = re.sub(r'"' + O + r'"', '"' + NEW + '"', n)
    if f == ".config/layers.toml":
        n = re.sub(r'^((?:from|to)\s*=\s*)"' + O + r'"', r'\g<1>"' + NEW + '"', n, flags=re.M)
        n = re.sub(r'(may_depend_on_packages\s*=\s*\[[^\]]*)"' + O + r'"', r'\g<1>"' + NEW + '"', n)
    if n != t:
        open(f, "w").write(n)
        changed.add(f)

logs = subprocess.run(
    ["git", "grep", "-n", "-E", r"RUST_LOG[^\n]*\b" + OLD_LIB + r"(=|::)|\b" + OLD_LIB + r"=(trace|debug|info|warn|error)\b",
     "--", ":!*.lock", ":!vendor"],
    capture_output=True, text=True,
).stdout.strip()

# Residual check, independent of the rewrite: bare `old::` left in a
# dependent's code (comments and strings stripped) that declares no `old`.
STRINGS = re.compile(r'r#*"(?:.|\n)*?"#*|"(?:\\.|[^"\\])*"')
residual = []
for d in src_dirs:
    for f in subprocess.check_output(["git", "ls-files", "--", f"{d}/*.rs", f"{d}/**/*.rs"]).decode().split():
        if not os.path.exists(f):
            continue
        rel = os.path.relpath(f, d)
        if d == new_dir and not rel.startswith(("src/bin/", "tests/", "benches/", "examples/")):
            continue
        code = STRINGS.sub('""', COMMENTS.sub("", open(f).read()))
        if local_decl.search(code):
            continue
        for m in re.finditer(r"(?<![\w:.$])" + L + r"::", code):
            residual.append(f"{f}: ...{code[max(0, m.start() - 30):m.end() + 20]!r}")
            break

print(f"renamed {OLD} -> {NEW} ({crate_dir} -> {new_dir}); rewrote {len(changed)} files")
if residual:
    print(f"residual `{OLD_LIB}::` paths (fix by hand):")
    for r in residual:
        print("  " + r)
if review:
    print(f"review (file declares its own `{OLD_LIB}`; bare `{OLD_LIB}::` paths left alone):")
    for f in review:
        print("  " + f)
if logs:
    print("tracing filters naming the old crate (update by hand):")
    print(logs)
