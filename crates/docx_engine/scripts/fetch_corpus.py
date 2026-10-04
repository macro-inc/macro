#!/usr/bin/env python3
"""Download the fidelity corpus listed in tests/corpus/manifest.json.

Usage:
    python3 crates/docx_engine/scripts/fetch_corpus.py OUT_DIR [--manifest PATH]

Each entry's `source_url` is saved as OUT_DIR/<file>. When the entry names a
Word-exported PDF (`word_pdf`) and its notes give the PDF's source URL, that
PDF is saved next to it as OUT_DIR/<stem>.word.pdf, which
`render_references.py` turns into Word reference pages. Files already present
are kept. The documents stay outside the repository: they belong to their
publishers (see each entry's `license` and `provenance`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().parent.parent / "tests" / "corpus" / "manifest.json"
# A PDF URL ends in `.pdf`, or asks an API for one (`t=pdf`, as the UN's
# document system does).
PDF_SOURCE = re.compile(r"source (https?://\S+?(?:\.pdf|[?&]t=pdf))", re.IGNORECASE)


def fetch(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    request = urllib.request.Request(url, headers={"User-Agent": "docx-engine-corpus/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    except Exception as error:  # noqa: BLE001 - report and continue
        print(f"  failed: {url}: {error}", file=sys.stderr)
        return False
    dest.write_bytes(data)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    entries = json.loads(args.manifest.read_text())
    failed = 0
    for entry in entries:
        name = entry["file"]
        print(name)
        if not fetch(entry["source_url"], args.out / name):
            failed += 1
            continue
        pdf = entry.get("word_pdf")
        match = PDF_SOURCE.search(entry.get("notes", ""))
        if pdf and match and not fetch(match.group(1), args.out / pdf):
            failed += 1
    print(f"{len(entries) - failed} of {len(entries)} documents ready in {args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
