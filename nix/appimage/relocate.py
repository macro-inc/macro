#!/usr/bin/env python3
"""Finalize linuxdeploy's AppDir before the output plugin creates the squashfs."""

import os
import re
import stat
import subprocess
import sys
from pathlib import Path


def patchelf(path, *args):
    return subprocess.check_output(["patchelf", *args, str(path)], text=True).strip()


def elf_files(root):
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as stream:
            if stream.read(4) == b"\x7fELF":
                yield path


def check_schema_paths(appdir):
    for relative in (
        "usr/lib/libpxbackend-1.0.so",
        "usr/lib/libgiognomeproxy.so",
        "usr/lib/gio/modules/libgiognomeproxy.so",
    ):
        path = Path(appdir) / relative
        if path.is_file() and re.search(
            rb"/nix/store/[^\x00\n]*gsettings-desktop-schemas[^\x00\n]*/glib-2\.0/schemas",
            path.read_bytes(),
        ):
            raise RuntimeError(f"Nix-only GSettings lookup in {path}")


def relocate(appdir):
    appdir = Path(appdir).resolve()
    libdir = appdir / "usr/lib"
    dynamic = []
    for path in elf_files(appdir):
        # AppImage's static launcher has no dynamic section.
        result = subprocess.run(
            ["patchelf", "--print-needed", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            continue
        # Tauri's additional files retain read-only Nix store permissions.
        path.chmod(path.stat().st_mode | stat.S_IWUSR)
        dynamic.append((path, result.stdout.splitlines()))
        soname = patchelf(path, "--print-soname")
        if soname:
            if "/" in soname:
                raise RuntimeError(f"invalid SONAME {soname!r}: {path}")
            alias = path.with_name(soname)
            if alias.exists() or alias.is_symlink():
                if alias.resolve() != path.resolve():
                    raise RuntimeError(f"conflicting SONAME {soname}: {alias}, {path}")
            else:
                alias.symlink_to(path.name)

    for path, needed in dynamic:
        for name in needed:
            if name.startswith("/nix/store/"):
                basename = Path(name).name
                if not (libdir / basename).is_file():
                    raise RuntimeError(f"unbundled absolute dependency {name}: {path}")
                patchelf(path, "--replace-needed", name, basename)

        # Every library needs its own RUNPATH: DT_RUNPATH is not inherited by
        # transitive dependencies (including GIO modules and WebKit helpers).
        relative_lib = os.path.relpath(libdir, path.parent)
        rpaths = ["$ORIGIN"]
        if relative_lib != ".":
            rpaths.append(f"$ORIGIN/{relative_lib}")
        for entry in patchelf(path, "--print-rpath").split(":"):
            if entry.startswith(("$ORIGIN", "${ORIGIN}")) and entry not in rpaths:
                rpaths.append(entry)
        patchelf(path, "--set-rpath", ":".join(rpaths))

        interpreter = subprocess.run(
            ["patchelf", "--print-interpreter", str(path)],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        if interpreter.startswith("/nix/store/"):
            if Path(interpreter).name != "ld-linux-x86-64.so.2":
                raise RuntimeError(f"unexpected interpreter {interpreter}: {path}")
            patchelf(path, "--set-interpreter", "/lib64/ld-linux-x86-64.so.2")

        if path.name.startswith("libwebkit2gtk-"):
            # Release WebKit ignores WEBKIT_EXEC_PATH. Tauri's AppRun changes
            # cwd to AppDir/usr, and its upstream GTK plugin likewise patches
            # compiled-in absolute paths to relative ones. Keep ELF offsets
            # unchanged by NUL-padding the replacement PKGLIBEXECDIR string.
            contents = path.read_bytes()
            relocated = re.sub(
                rb"/nix/store/[^/\x00]+/libexec/webkit2gtk-4\.1\x00",
                lambda match: b"./bin\x00".ljust(len(match[0]), b"\x00"),
                contents,
            )
            if contents != relocated:
                path.write_bytes(relocated)

    # Tauri copies Nix's xdg-utils scripts verbatim. Their build-time shebangs
    # must not leak into the distributable image either.
    for path in (appdir / "usr/bin").iterdir():
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as stream:
            first = stream.readline(256)
        if first.startswith(b"#!/nix/store/"):
            shell = first.decode().strip().rsplit("/", 1)[-1]
            if shell not in ("sh", "bash"):
                raise RuntimeError(f"unexpected Nix shebang: {path}: {first!r}")
            content = path.read_bytes()
            path.chmod(path.stat().st_mode | stat.S_IWUSR)
            path.write_bytes(
                f"#!/usr/bin/env {shell}\n".encode() + content[len(first) :]
            )

    # Fail the build rather than silently shipping another Nix-only ELF.
    for path, _ in dynamic:
        for field in ("needed", "rpath"):
            if "/nix/store/" in patchelf(path, f"--print-{field}"):
                raise RuntimeError(f"unrelocated {field}: {path}")
    check_schema_paths(appdir)
    print(f"Relocated {len(dynamic)} ELF files in {appdir}")


if __name__ == "__main__":
    relocate(sys.argv[1])
