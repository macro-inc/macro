#!/usr/bin/env python3
"""Drop explicit crate paths from .config/layers.toml that a group glob in the same layer already covers."""
import re
p = ".config/layers.toml"
s = open(p).read()
out = []
for block in re.split(r"(?=^\[\[layer\]\])", s, flags=re.M):
    globs = re.findall(r'"(crates/[\w-]+)/\*\*"', block)
    def keep(line):
        m = re.match(r'\s*"(crates/[\w-]+)/[^"*]+",\s*$', line)
        return not (m and m.group(1) in globs)
    out.append("".join(l for l in block.splitlines(keepends=True) if keep(l)))
open(p, "w").write("".join(out))
