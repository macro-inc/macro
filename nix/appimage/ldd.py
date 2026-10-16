#!/usr/bin/env python3
"""Resolve the full ELF dependency graph for linuxdeploy without executing it."""

import os
import subprocess
import sys
from pathlib import Path


def elf_field(binary, field):
    return subprocess.check_output(
        ["patchelf", f"--print-{field}", str(binary)], text=True
    ).strip()


def resolve(binary, needed):
    if needed.startswith("/"):
        path = Path(needed)
        return path if path.is_file() else None

    origin = str(binary.resolve().parent)
    rpath = elf_field(binary, "rpath")
    paths = rpath.split(":") + os.environ.get("LD_LIBRARY_PATH", "").split(":")
    paths += ["/lib", "/usr/lib", "/lib64", "/usr/lib64"]
    for entry in paths:
        if not entry:
            continue
        entry = entry.replace("${ORIGIN}", origin).replace("$ORIGIN", origin)
        candidate = Path(entry) / needed
        if candidate.is_file():
            # Keep the SONAME alias. Resolving symlinks here makes linuxdeploy
            # copy libfoo.so.1.2 without the libfoo.so.1 name its callers need.
            return candidate.absolute()
    return None


def dependencies(binary):
    queue = [Path(binary)]
    visited = set()
    result = {}
    for current in queue:
        real = current.resolve()
        if real in visited:
            continue
        visited.add(real)
        for needed in elf_field(current, "needed").splitlines():
            # Like the loader, reuse the first loaded SONAME. Nix closures may
            # contain multiple build variants of the same ABI (e.g. libwebp).
            if needed in result:
                continue
            resolved = resolve(current, needed)
            if resolved is None:
                raise RuntimeError(f"{current}: {needed} => not found")
            result[needed] = resolved
            queue.append(resolved)
    return result


if __name__ == "__main__":
    try:
        for name, path in dependencies(sys.argv[1]).items():
            print(f"\t{name} => {path} (0x0000000000000000)")
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
