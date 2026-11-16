#!/usr/bin/env python3
"""Check packaged session libraries and Android's 16 KB native requirements."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check-android-apk.py APK")
    apk = Path(sys.argv[1]).resolve(strict=True)
    sdk = Path(os.environ["ANDROID_HOME"])
    ndk = Path(os.environ["NDK_HOME"])
    host = "darwin-x86_64" if sys.platform == "darwin" else "linux-x86_64"
    readelf = ndk / "toolchains/llvm/prebuilt" / host / "bin/llvm-readelf"
    zipalign = sdk / "build-tools/36.0.0/zipalign"
    errors: list[str] = []
    with zipfile.ZipFile(apk) as archive, tempfile.TemporaryDirectory(
        prefix="native-editor-apk-", dir=os.environ.get("TMPDIR")
    ) as temporary:
        libraries: dict[str, set[str]] = {}
        for entry in archive.namelist():
            match = re.fullmatch(r"lib/([^/]+)/([^/]+\.so)", entry)
            if not match:
                continue
            abi, name = match.groups()
            libraries.setdefault(abi, set()).add(name)
            if abi not in {"arm64-v8a", "x86_64"}:
                continue
            extracted = Path(temporary) / f"{abi}-{name}"
            extracted.write_bytes(archive.read(entry))
            headers = subprocess.check_output([readelf, "-l", extracted], text=True)
            loads = [line.split() for line in headers.splitlines() if line.strip().startswith("LOAD")]
            if not loads or any(int(row[-1], 16) < 16384 for row in loads):
                errors.append(f"{entry}: ELF LOAD alignment is below 16 KB")
            else:
                print(f"{entry}: ELF LOAD alignment supports 16 KB")
        if not libraries:
            errors.append("APK has no native libraries")
        for abi, names in libraries.items():
            for required in ("libdocument_session_ffi.so", "libjnidispatch.so"):
                if required not in names:
                    errors.append(f"{abi}: missing {required}")
        alignment = subprocess.run([zipalign, "-c", "-P", "16", "4", apk], check=False)
        if alignment.returncode:
            errors.append("APK ZIP alignment failed")
    if errors:
        raise SystemExit("\n".join(errors))
    print("Packaged native session libraries and APK alignment pass")


if __name__ == "__main__":
    main()
