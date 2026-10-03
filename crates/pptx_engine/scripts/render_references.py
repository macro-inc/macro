#!/usr/bin/env python3
"""Render LibreOffice reference PNGs for .pptx files (pixel-diff baselines).

Usage:
    python3 crates/pptx_engine/scripts/render_references.py OUT_DIR deck.pptx [...] \
        [--width 960] [--jobs N] [--force] [--keep-pdf] [--timeout 300]

For every input deck this:
  1. converts it to PDF with headless LibreOffice, *including hidden slides* and
     excluding notes pages, using a private user profile per worker so parallel
     runs never share (and corrupt) a profile;
  2. rasterizes the PDF with `pdftoppm -png -scale-to-x WIDTH -scale-to-y -1`
     into OUT_DIR/<stem>/slide-001.png, slide-002.png, ...;
  3. writes OUT_DIR/<stem>/meta.json:
       {slides, width, height, libreoffice_version, source_sha256, ...}

A deck is skipped when its meta.json already records the same source_sha256 and
width (use --force to re-render). The PDF page count is checked against the
slide count from python-pptx (hidden slides included); a mismatch is reported as
a warning and recorded in meta.json as "page_count_mismatch": true.

LibreOffice is only a *reference* renderer: it is close to, but not identical to,
PowerPoint. Treat its output as a baseline for regressions, not as ground truth.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

PDF_FILTER = (
    'pdf:impress_pdf_Export:{'
    '"ExportHiddenSlides":{"type":"boolean","value":"true"},'
    '"ExportNotesPages":{"type":"boolean","value":"false"}'
    '}'
)

_thread_state = threading.local()
_profiles: list[str] = []
_profiles_lock = threading.Lock()
_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, file=sys.stderr, flush=True)


def soffice_binary() -> str:
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    sys.exit("error: soffice/libreoffice not found on PATH")


def libreoffice_version(soffice: str) -> str:
    try:
        out = subprocess.run(
            [soffice, "--version"], capture_output=True, text=True, timeout=120
        ).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    return out or "unknown"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slide_count(path: Path) -> int | None:
    """Slide count including hidden slides (python-pptx, zip fallback)."""
    try:
        from pptx import Presentation  # type: ignore

        return len(Presentation(str(path)).slides)
    except Exception:  # noqa: BLE001 - python-pptx rejects some valid wild files
        pass
    try:
        with zipfile.ZipFile(path) as zf:
            xml = zf.read("ppt/presentation.xml").decode("utf-8", "replace")
        return len(re.findall(r"<p:sldId\b", xml))
    except Exception:  # noqa: BLE001
        return None


def pdf_pages(pdf: Path) -> int | None:
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=120
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    return int(m.group(1)) if m else None


def worker_profile() -> str:
    """One LibreOffice user profile per worker thread, reused across decks."""
    prof = getattr(_thread_state, "profile", None)
    if prof is None:
        prof = tempfile.mkdtemp(prefix="pptx-ref-lo-profile-")
        _thread_state.profile = prof
        with _profiles_lock:
            _profiles.append(prof)
    return prof


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as fh:
        head = fh.read(24)
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def render_one(src: Path, out_root: Path, args, soffice: str, lo_version: str) -> dict:
    stem = src.stem
    out_dir = out_root / stem
    meta_path = out_dir / "meta.json"
    digest = sha256_file(src)

    if not args.force and meta_path.exists():
        try:
            old = json.loads(meta_path.read_text())
            if (
                old.get("source_sha256") == digest
                and old.get("requested_width") == args.width
                and old.get("ok")
            ):
                return {"file": str(src), "status": "cached", "meta": old}
        except (OSError, ValueError):
            pass

    expected = slide_count(src)
    profile = worker_profile()
    with tempfile.TemporaryDirectory(prefix="pptx-ref-") as tmp:
        tmp_path = Path(tmp)
        # Copy to a neutral name: LibreOffice derives the PDF name from the input
        # and dislikes some characters; this also avoids touching the source dir.
        work_src = tmp_path / ("input" + src.suffix.lower())
        shutil.copyfile(src, work_src)
        cmd = [
            soffice,
            f"-env:UserInstallation=file://{profile}",
            "--headless",
            "--norestore",
            "--nologo",
            "--convert-to",
            PDF_FILTER,
            "--outdir",
            str(tmp_path),
            str(work_src),
        ]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=args.timeout
            )
            lo_log = (proc.stdout + proc.stderr).strip()
        except subprocess.TimeoutExpired:
            return {"file": str(src), "status": "error", "error": f"soffice timed out after {args.timeout}s"}
        pdf = tmp_path / "input.pdf"
        if not pdf.exists():
            return {"file": str(src), "status": "error", "error": "no PDF produced", "log": lo_log[-2000:]}

        pages = pdf_pages(pdf)
        png_prefix = tmp_path / "page"
        try:
            subprocess.run(
                [
                    "pdftoppm",
                    "-png",
                    "-scale-to-x",
                    str(args.width),
                    "-scale-to-y",
                    "-1",
                    str(pdf),
                    str(png_prefix),
                ],
                check=True,
                capture_output=True,
                timeout=args.timeout,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            return {"file": str(src), "status": "error", "error": f"pdftoppm failed: {e}"}

        pngs = sorted(
            tmp_path.glob("page-*.png"),
            key=lambda p: int(re.search(r"-(\d+)\.png$", p.name).group(1)),
        )
        if out_dir.exists():
            for old in out_dir.glob("slide-*.png"):
                old.unlink()
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(pngs, start=1):
            shutil.move(str(p), out_dir / f"slide-{i:03d}.png")
        if args.keep_pdf:
            shutil.copyfile(pdf, out_dir / f"{stem}.pdf")

    width = height = None
    first = out_dir / "slide-001.png"
    if first.exists():
        width, height = png_size(first)
    mismatch = expected is not None and pages != expected
    meta = {
        "source": src.name,
        "source_sha256": digest,
        "slides": len(pngs),
        "expected_slides": expected,
        "pdf_pages": pages,
        "page_count_mismatch": mismatch,
        "requested_width": args.width,
        "width": width,
        "height": height,
        "libreoffice_version": lo_version,
        "pdf_filter": PDF_FILTER,
        "ok": bool(pngs),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    status = "rendered" if pngs else "error"
    result = {"file": str(src), "status": status, "meta": meta}
    if mismatch:
        result["warning"] = f"PDF has {pages} pages but deck has {expected} slides"
    return result


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("out_dir")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--width", type=int, default=960, help="PNG width in pixels (default 960)")
    ap.add_argument("--jobs", "-j", type=int, default=1, help="parallel LibreOffice workers")
    ap.add_argument("--force", action="store_true", help="ignore the meta.json cache")
    ap.add_argument("--keep-pdf", action="store_true", help="also keep <stem>.pdf next to the PNGs")
    ap.add_argument("--timeout", type=int, default=300, help="per-step timeout in seconds")
    args = ap.parse_args(argv)

    files = [Path(f) for f in args.files]
    missing = [str(f) for f in files if not f.is_file()]
    if missing:
        sys.exit(f"error: not a file: {', '.join(missing)}")
    stems: dict[str, Path] = {}
    for f in files:
        if f.stem in stems and stems[f.stem].resolve() != f.resolve():
            sys.exit(f"error: output name collision for stem {f.stem!r}: {stems[f.stem]} and {f}")
        stems[f.stem] = f

    out_root = Path(args.out_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    soffice = soffice_binary()
    lo_version = libreoffice_version(soffice)

    failures = warnings = 0
    try:
        with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            futs = {ex.submit(render_one, f, out_root, args, soffice, lo_version): f for f in files}
            for fut in cf.as_completed(futs):
                src = futs[fut]
                try:
                    res = fut.result()
                except Exception as e:  # noqa: BLE001
                    res = {"file": str(src), "status": "error", "error": repr(e)}
                status = res["status"]
                meta = res.get("meta", {})
                line = f"[{status:8s}] {src}"
                if meta:
                    line += f"  slides={meta.get('slides')} {meta.get('width')}x{meta.get('height')}"
                if status == "error":
                    failures += 1
                    line += f"  ERROR: {res.get('error')}"
                    if res.get("log"):
                        line += f"\n    soffice: {res['log']}"
                if res.get("warning"):
                    warnings += 1
                    line += f"  WARNING: {res['warning']}"
                log(line)
    finally:
        for prof in _profiles:
            shutil.rmtree(prof, ignore_errors=True)

    log(f"done: {len(files)} decks, {failures} failed, {warnings} page-count warnings")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
