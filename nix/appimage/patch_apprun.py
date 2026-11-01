#!/usr/bin/env python3
"""Let the runtime hook own GSETTINGS_SCHEMA_DIR, without replacing AppRun."""

import sys
from pathlib import Path

SCHEMA_VARIABLE = b"GSETTINGS_SCHEMA_DIR"
IGNORED_VARIABLE = b"_APPIMAGE_SCHEMA_DIR"


def patch_apprun(source, destination):
    data = source.read_bytes()
    # The pinned legacy launcher always appends ':' to this variable, even
    # when unset. GLib requires one directory, not a colon-separated list.
    # Rename both the getenv key and the assignment-format key, preserving ELF
    # offsets and all other behavior (including the cwd used by WebKit helpers).
    if len(SCHEMA_VARIABLE) != len(IGNORED_VARIABLE):
        raise ValueError("AppRun replacement must preserve ELF offsets")
    if (
        not data.startswith(b"\x7fELF")
        or data.count(SCHEMA_VARIABLE) != 2
        or data.count(SCHEMA_VARIABLE + b"\0") != 1
        or data.count(SCHEMA_VARIABLE + b"=") != 1
    ):
        raise ValueError("Unsupported AppRun: expected one schema getter and setter")
    destination.write_bytes(data.replace(SCHEMA_VARIABLE, IGNORED_VARIABLE))
    destination.chmod(0o755)


if __name__ == "__main__":
    patch_apprun(Path(sys.argv[1]), Path(sys.argv[2]))
