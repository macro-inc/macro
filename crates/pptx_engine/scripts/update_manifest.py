#!/usr/bin/env python3
"""Refresh tests/corpus/manifest.json from the decks in generated/ and wild/.

Usage:
    python3 crates/pptx_engine/scripts/update_manifest.py
    python3 crates/pptx_engine/scripts/update_manifest.py --add wild/foo.pptx \
        --source-url URL --provenance "..." --description "..." [--feature converted-from-ppt ...]

Derived fields are recomputed on every run: sha256, bytes, slides (incl. hidden),
generator (docProps/app.xml Application + AppVersion) and features (inspect_pptx
feature tags plus `curated_features`). Curated fields are preserved: description,
provenance, source_url, retrieved, notes, curated_features. generate_corpus.py
supplies descriptions/curated features for generated decks.

Entries whose file disappeared are dropped (with a warning); a wild file without
provenance or source_url is an error, so nothing undocumented slips in.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.dont_write_bytecode = True  # keep __pycache__ out of the repo

import inspect_pptx  # noqa: E402

CORPUS_DIR = SCRIPT_DIR.parent / "tests" / "corpus"
MANIFEST = CORPUS_DIR / "manifest.json"
GENERATED_PROVENANCE = (
    "Synthetic deck written by scripts/generate_corpus.py from code-generated content (no third-party material); "
    "same license as this repository."
)
FIELD_ORDER = ["path", "kind", "sha256", "bytes", "slides", "generator", "source_url", "retrieved", "provenance",
               "description", "features", "curated_features", "notes"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generator_string(inv: dict) -> str:
    app = (inv.get("application") or "").strip()
    ver = (inv.get("app_version") or "").strip()
    if not app and not ver:
        return "unknown (no docProps/app.xml)"
    return " ".join(x for x in (app or "(no Application)", ver) if x)


def load() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"files": []}


def update(generated_info: dict | None = None, add: dict | None = None) -> dict:
    manifest = load()
    old = {e["path"]: e for e in manifest.get("files", [])}
    if add:
        old.setdefault(add["path"], {"path": add["path"], "kind": add["path"].split("/")[0]})
        old[add["path"]].update({k: v for k, v in add.items() if v not in (None, [], "")})
    new = {}
    problems = []
    for kind in ("generated", "wild"):
        for f in sorted((CORPUS_DIR / kind).glob("*.pptx")):
            rel = f"{kind}/{f.name}"
            e = dict(old.get(rel, {"path": rel}))
            e["kind"] = kind
            inv = inspect_pptx.inspect(str(f))
            e["sha256"] = sha256(f)
            e["bytes"] = f.stat().st_size
            e["slides"] = inv["slides"]
            e["generator"] = generator_string(inv)
            if kind == "generated":
                e["provenance"] = GENERATED_PROVENANCE
                info = (generated_info or {}).get(rel)
                if info:
                    e["description"] = info["description"]
                    e["curated_features"] = sorted(set(info.get("extra_features") or []))
            else:
                for field in ("source_url", "provenance"):
                    if not e.get(field):
                        problems.append(f"{rel}: missing {field}")
            curated = e.get("curated_features") or []
            e["features"] = sorted(set(inspect_pptx.feature_tags(inv)) | set(curated))
            e.setdefault("description", "")
            new[rel] = {k: e[k] for k in FIELD_ORDER if k in e}
            for k in e:
                if k not in new[rel]:
                    new[rel][k] = e[k]
    stems: dict[str, str] = {}
    for rel in new:
        stem = Path(rel).stem
        if stem in stems:
            problems.append(f"{rel}: same file stem as {stems[stem]} (render_references.py keys output by stem)")
        stems[stem] = rel
    for gone in sorted(set(old) - set(new)):
        print(f"warning: dropping manifest entry for missing file {gone}", file=sys.stderr)
    if problems:
        raise SystemExit("manifest errors:\n  " + "\n  ".join(problems))
    files = sorted(new.values(), key=lambda e: (e["kind"] != "generated", e["path"]))
    out = {
        "schema": "pptx_engine corpus manifest v1",
        "totals": {
            "files": len(files),
            "generated": sum(1 for e in files if e["kind"] == "generated"),
            "wild": sum(1 for e in files if e["kind"] == "wild"),
            "bytes": sum(e["bytes"] for e in files),
        },
        "files": files,
    }
    MANIFEST.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {MANIFEST} ({len(files)} files)", file=sys.stderr)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--add", help="corpus-relative path of a wild file to register, e.g. wild/foo.pptx")
    ap.add_argument("--source-url")
    ap.add_argument("--provenance")
    ap.add_argument("--description")
    ap.add_argument("--notes")
    ap.add_argument("--retrieved", default=datetime.date.today().isoformat())
    ap.add_argument("--feature", action="append", default=[], help="extra curated feature tag (repeatable)")
    args = ap.parse_args(argv)
    add = None
    if args.add:
        if not (CORPUS_DIR / args.add).is_file():
            ap.error(f"{args.add} does not exist under {CORPUS_DIR}")
        add = {"path": args.add, "source_url": args.source_url, "provenance": args.provenance,
               "description": args.description, "notes": args.notes, "retrieved": args.retrieved,
               "curated_features": sorted(set(args.feature))}
    update(add=add)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
