#!/usr/bin/env python3
"""Render reference PNGs for .docx files (pixel-diff baselines).

Usage:
    python3 crates/docx_engine/scripts/render_references.py OUT_DIR doc.docx [...] \
        [--width 816] [--jobs N] [--force] [--timeout 300] [--fontconfig FONTS_CONF]

For every input document this writes:
  OUT_DIR/lo/<stem>/page-001.png ...   LibreOffice's rendering (via PDF export)
  OUT_DIR/lo/<stem>/meta.json          {pages, width, height, libreoffice_version, source_sha256, ...}
and, when a Word-exported PDF of the same document sits next to it as
`<stem>.word.pdf`:
  OUT_DIR/word/<stem>/page-001.png ...  Microsoft Word's rendering

With --fontconfig (from `docx_corpus fontconfig --out FONTS_CONF`), LibreOffice
uses the engine's bundled fonts and substitutions, so its renders differ from
the engine's in layout and rasterization rather than in fallback-font choice.
Word PDFs embed Word's real fonts and are the ground truth for layout.

A document is skipped when its meta.json records the same source hash, width
and fontconfig (use --force to re-render). Parallel workers each use a private
LibreOffice profile.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

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
        out = subprocess.run([soffice, "--version"], capture_output=True, text=True, timeout=120).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    return out or "unknown"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pdf_pages(pdf: Path) -> int | None:
    try:
        out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=120).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    return int(m.group(1)) if m else None


def worker_profile() -> str:
    prof = getattr(_thread_state, "profile", None)
    if prof is None:
        prof = tempfile.mkdtemp(prefix="docx-ref-lo-profile-")
        _thread_state.profile = prof
        with _profiles_lock:
            _profiles.append(prof)
    return prof


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as fh:
        head = fh.read(24)
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def rasterize(pdf: Path, out_dir: Path, width: int, timeout: int) -> list[Path]:
    with tempfile.TemporaryDirectory(prefix="docx-ref-png-") as tmp:
        prefix = Path(tmp) / "page"
        subprocess.run(
            ["pdftoppm", "-png", "-scale-to-x", str(width), "-scale-to-y", "-1", str(pdf), str(prefix)],
            check=True,
            capture_output=True,
            timeout=timeout,
        )
        pngs = sorted(Path(tmp).glob("page-*.png"), key=lambda p: int(re.search(r"-(\d+)\.png$", p.name).group(1)))
        if out_dir.exists():
            for old in out_dir.glob("page-*.png"):
                old.unlink()
        out_dir.mkdir(parents=True, exist_ok=True)
        out = []
        for i, p in enumerate(pngs, start=1):
            dest = out_dir / f"page-{i:03d}.png"
            shutil.move(str(p), dest)
            out.append(dest)
        return out


def cached(meta_path: Path, digest: str, args) -> dict | None:
    if args.force or not meta_path.exists():
        return None
    try:
        old = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return None
    fc = sha256_file(Path(args.fontconfig)) if args.fontconfig else None
    if old.get("source_sha256") == digest and old.get("requested_width") == args.width and old.get("fontconfig_sha256") == fc and old.get("ok"):
        return old
    return None


def render_one(src: Path, out_root: Path, args, soffice: str, lo_version: str) -> dict:
    stem = src.stem
    result: dict = {"file": str(src)}
    # Word's own PDF, when the corpus has one.
    word_pdf = src.with_name(stem + ".word.pdf")
    if word_pdf.exists():
        word_dir = out_root / "word" / stem
        meta_path = word_dir / "meta.json"
        digest = sha256_file(word_pdf)
        if cached(meta_path, digest, argparse.Namespace(force=args.force, fontconfig=None, width=args.width)) is None:
            pngs = rasterize(word_pdf, word_dir, args.width, args.timeout)
            w, h = png_size(pngs[0]) if pngs else (None, None)
            meta_path.write_text(json.dumps({
                "source": word_pdf.name, "source_sha256": digest, "pages": len(pngs),
                "requested_width": args.width, "width": w, "height": h,
                "fontconfig_sha256": None, "ok": bool(pngs),
            }, indent=2) + "\n")
        result["word"] = True

    lo_dir = out_root / "lo" / stem
    meta_path = lo_dir / "meta.json"
    digest = sha256_file(src)
    old = cached(meta_path, digest, args)
    if old is not None:
        result.update(status="cached", meta=old)
        return result
    profile = worker_profile()
    with tempfile.TemporaryDirectory(prefix="docx-ref-") as tmp:
        tmp_path = Path(tmp)
        work_src = tmp_path / ("input" + src.suffix.lower())
        shutil.copyfile(src, work_src)
        cmd = [soffice, f"-env:UserInstallation=file://{profile}", "--headless", "--norestore", "--nologo",
               "--convert-to", "pdf:writer_pdf_Export", "--outdir", str(tmp_path), str(work_src)]
        env = dict(os.environ)
        if args.fontconfig:
            env["FONTCONFIG_FILE"] = str(Path(args.fontconfig).resolve())
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout, env=env)
            lo_log = (proc.stdout + proc.stderr).strip()
        except subprocess.TimeoutExpired:
            result.update(status="error", error=f"soffice timed out after {args.timeout}s")
            return result
        pdf = tmp_path / "input.pdf"
        if not pdf.exists():
            result.update(status="error", error="no PDF produced", log=lo_log[-2000:])
            return result
        pages = pdf_pages(pdf)
        try:
            pngs = rasterize(pdf, lo_dir, args.width, args.timeout)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            result.update(status="error", error=f"pdftoppm failed: {e}")
            return result
        if args.keep_pdf:
            shutil.copyfile(pdf, lo_dir / f"{stem}.pdf")
    w, h = png_size(pngs[0]) if pngs else (None, None)
    meta = {
        "source": src.name, "source_sha256": digest, "pages": len(pngs), "pdf_pages": pages,
        "requested_width": args.width, "width": w, "height": h,
        "libreoffice_version": lo_version,
        "fontconfig_sha256": sha256_file(Path(args.fontconfig)) if args.fontconfig else None,
        "ok": bool(pngs),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    result.update(status="rendered" if pngs else "error", meta=meta)
    return result


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out_dir")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--width", type=int, default=816, help="PNG width in pixels (default 816 = 96 DPI Letter)")
    ap.add_argument("--jobs", "-j", type=int, default=1, help="parallel LibreOffice workers")
    ap.add_argument("--force", action="store_true", help="ignore the meta.json cache")
    ap.add_argument("--keep-pdf", action="store_true", help="also keep the LibreOffice PDF")
    ap.add_argument("--timeout", type=int, default=300, help="per-step timeout in seconds")
    ap.add_argument("--fontconfig", help="FONTCONFIG_FILE for LibreOffice (see `docx_corpus fontconfig`)")
    args = ap.parse_args(argv)

    files = [Path(f) for f in args.files if f.lower().endswith((".docx", ".docm", ".dotx"))]
    missing = [str(f) for f in files if not f.is_file()]
    if missing:
        sys.exit(f"error: not a file: {', '.join(missing)}")
    out_root = Path(args.out_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    soffice = soffice_binary()
    lo_version = libreoffice_version(soffice)
    failures = 0
    try:
        with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            futs = {ex.submit(render_one, f, out_root, args, soffice, lo_version): f for f in files}
            for fut in cf.as_completed(futs):
                src = futs[fut]
                try:
                    res = fut.result()
                except Exception as e:  # noqa: BLE001
                    res = {"file": str(src), "status": "error", "error": repr(e)}
                meta = res.get("meta", {})
                line = f"[{res.get('status', '?'):8s}] {src}  pages={meta.get('pages')}"
                if res.get("word"):
                    line += "  +word"
                if res.get("status") == "error":
                    failures += 1
                    line += f"  ERROR: {res.get('error')}"
                log(line)
    finally:
        for prof in _profiles:
            shutil.rmtree(prof, ignore_errors=True)
    log(f"done: {len(files)} documents, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
