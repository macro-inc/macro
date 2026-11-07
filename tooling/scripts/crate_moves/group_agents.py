#!/usr/bin/env python3
"""Write crates/<group>/AGENTS.md (+ CLAUDE.md symlink) listing the group's crates.

usage: group_agents.py <group> <layer> "<one-paragraph description>"
Each crate's line comes from the first sentence of its AGENTS.md "What it is"
section (or its Cargo.toml description).
"""
import os, re, sys

group, layer, desc = sys.argv[1:4]
gdir = os.path.join("crates", group)


def shorten(s, limit=170):
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0].rstrip(",;:(")
    return cut + " …"


def summary(crate_dir):
    a = os.path.join(crate_dir, "AGENTS.md")
    if os.path.exists(a):
        text = open(a).read()
        m = re.search(r"## What it is\s*\n+(.+?)(?:\n\n|\Z)", text, re.S)
        if m:
            para = " ".join(m.group(1).split())
            s = re.split(r"(?<=[.!?])\s", para, maxsplit=1)[0]
            return shorten(s)
    c = os.path.join(crate_dir, "Cargo.toml")
    if os.path.exists(c):
        m = re.search(r'^description\s*=\s*"(.*)"', open(c).read(), re.M)
        if m:
            return m.group(1)
    return ""


def package(crate_dir):
    m = re.search(r'^name\s*=\s*"(.*)"', open(os.path.join(crate_dir, "Cargo.toml")).read(), re.M)
    return m.group(1)


rows = []
for name in sorted(os.listdir(gdir)):
    d = os.path.join(gdir, name)
    if os.path.isdir(d) and os.path.exists(os.path.join(d, "Cargo.toml")):
        s = summary(d)
        link = f"[`{name}`]({name}/AGENTS.md)" if os.path.exists(os.path.join(d, "AGENTS.md")) else f"`{name}`"
        pkg = package(d)
        pkg_note = f" (package `{pkg}`)" if pkg != name else ""
        rows.append(f"| {link}{pkg_note} | {s} |")

out = f"""# crates/{group}

## What it is

{desc}

Layer: `{layer}` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
""" + "\n".join(rows) + """

## Recipes

- Add a crate here: create `crates/""" + group + """/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
"""
open(os.path.join(gdir, "AGENTS.md"), "w").write(out)
link = os.path.join(gdir, "CLAUDE.md")
if not os.path.lexists(link):
    os.symlink("AGENTS.md", link)
print(f"wrote {gdir}/AGENTS.md with {len(rows)} crates")
