#!/usr/bin/env python3
"""Print a JSON feature inventory for one or more .pptx files.

Usage:
    python3 crates/pptx_engine/scripts/inspect_pptx.py deck.pptx [more.pptx ...]
    python3 crates/pptx_engine/scripts/inspect_pptx.py --tags deck.pptx   # only feature tags

The inventory is computed straight from the OPC package (zipfile + lxml), so it
works on decks python-pptx refuses to open. Counts of DrawingML constructs
(geometries, fills, effects, ...) cover the slides plus the layouts and masters
those slides actually use; theme parts are not scanned, so the theme's fmtScheme
does not inflate them.

`feature_tags()` condenses an inventory into the short tag list stored in
tests/corpus/manifest.json.
"""

from __future__ import annotations

import argparse
import collections
import json
import posixpath
import re
import sys
import zipfile
from typing import Any

from lxml import etree

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    "ep": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    "a14": "http://schemas.microsoft.com/office/drawing/2010/main",
    "asvg": "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
    "v": "urn:schemas-microsoft-com:vml",
}

A = "{%s}" % NS["a"]
P = "{%s}" % NS["p"]
R = "{%s}" % NS["r"]

RT_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
RT_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
RT_MASTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
RT_OFFICE_DOC = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
)
RT_STRICT_OFFICE_DOC = "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument"

EMU_PER_INCH = 914400

MEDIA_EXT_ALIASES = {"jpg": "jpeg", "jpe": "jpeg", "tif": "tiff", "jfif": "jpeg"}

# Named slide sizes (cx, cy in EMU) -> label.
SLIDE_SIZE_NAMES = {
    (9144000, 6858000): "4:3 (10x7.5in)",
    (12192000, 6858000): "16:9 (13.333x7.5in)",
    (9144000, 5143500): "16:9 (10x5.625in)",
    (9144000, 5715000): "16:10 (10x6.25in)",
    (10287000, 6858000): "35mm (11.25x7.5in)",
    (7559675, 10691813): "A4 portrait",
    (10691813, 7559675): "A4 landscape",
    (6858000, 9144000): "4:3 portrait (7.5x10in)",
}


def _parse(zf: zipfile.ZipFile, name: str):
    try:
        data = zf.read(name)
    except KeyError:
        return None
    try:
        parser = etree.XMLParser(resolve_entities=False, huge_tree=True, recover=True)
        return etree.fromstring(data, parser)
    except etree.XMLSyntaxError:
        return None


def _rels_name(part: str) -> str:
    d, f = posixpath.split(part)
    return posixpath.join(d, "_rels", f + ".rels")


def _resolve(part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(part), target))


def _rels(zf: zipfile.ZipFile, part: str) -> list[dict[str, str]]:
    root = _parse(zf, _rels_name(part))
    if root is None:
        return []
    out = []
    for rel in root.findall("pr:Relationship", NS):
        out.append(
            {
                "id": rel.get("Id", ""),
                "type": rel.get("Type", ""),
                "target": rel.get("Target", ""),
                "mode": rel.get("TargetMode", "Internal"),
            }
        )
    return out


def _local(tag: Any) -> str:
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def _ext(name: str) -> str:
    ext = posixpath.splitext(name)[1].lower().lstrip(".")
    return MEDIA_EXT_ALIASES.get(ext, ext)


def _group_depth(el) -> int:
    depth = 0
    parent = el.getparent()
    while parent is not None:
        if parent.tag == P + "grpSp":
            depth += 1
        parent = parent.getparent()
    return depth


def inspect(path: str) -> dict[str, Any]:
    inv: dict[str, Any] = {"file": path}
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        name_set = set(names)

        # --- package metadata -------------------------------------------------
        app = _parse(zf, "docProps/app.xml")
        application = app_version = None
        if app is not None:
            application = app.findtext("ep:Application", namespaces=NS)
            app_version = app.findtext("ep:AppVersion", namespaces=NS)
        inv["application"] = application
        inv["app_version"] = app_version
        core = _parse(zf, "docProps/core.xml")
        if core is not None:
            inv["core_created"] = core.findtext(
                "{http://purl.org/dc/terms/}created"
            )
            inv["core_modified"] = core.findtext(
                "{http://purl.org/dc/terms/}modified"
            )

        # --- main document part ---------------------------------------------
        pres_part = "ppt/presentation.xml"
        for rel in _rels(zf, ""):
            if rel["type"] in (RT_OFFICE_DOC, RT_STRICT_OFFICE_DOC):
                pres_part = _resolve("", rel["target"])
        inv["strict_ooxml"] = any(
            rel["type"] == RT_STRICT_OFFICE_DOC for rel in _rels(zf, "")
        )
        pres = _parse(zf, pres_part)
        pres_rels = {r["id"]: r for r in _rels(zf, pres_part)}

        slide_parts: list[str] = []
        if pres is not None:
            sz = pres.find("p:sldSz", NS)
            if sz is not None:
                cx, cy = int(sz.get("cx", "0")), int(sz.get("cy", "0"))
                inv["slide_size"] = {
                    "cx": cx,
                    "cy": cy,
                    "inches": [round(cx / EMU_PER_INCH, 3), round(cy / EMU_PER_INCH, 3)],
                    "type": sz.get("type"),
                    "name": SLIDE_SIZE_NAMES.get((cx, cy), "custom"),
                }
            for sld_id in pres.findall("p:sldIdLst/p:sldId", NS):
                rid = sld_id.get(R + "id")
                rel = pres_rels.get(rid)
                if rel:
                    slide_parts.append(_resolve(pres_part, rel["target"]))
            emb = pres.findall("p:embeddedFontLst/p:embeddedFont", NS)
            inv["embedded_fonts"] = sorted(
                {
                    (e.find("p:font", NS).get("typeface") if e.find("p:font", NS) is not None else "?")
                    for e in emb
                }
            )
            sections = pres.findall(".//p14:sectionLst/p14:section", NS)
            inv["sections"] = [s.get("name") for s in sections]
        inv["slides"] = len(slide_parts)

        # --- per-part classification ------------------------------------------
        layouts = sorted(n for n in names if re.match(r"ppt/slideLayouts/[^/]+\.xml$", n))
        masters = sorted(n for n in names if re.match(r"ppt/slideMasters/[^/]+\.xml$", n))
        themes = sorted(n for n in names if re.match(r"ppt/theme/[^/]+\.xml$", n))
        notes = sorted(n for n in names if re.match(r"ppt/notesSlides/[^/]+\.xml$", n))
        inv["layouts"] = len(layouts)
        inv["masters"] = len(masters)
        inv["themes"] = len(themes)
        inv["notes_slides"] = len(notes)

        media = collections.Counter()
        media_bytes = collections.Counter()
        for info in zf.infolist():
            if info.filename.startswith("ppt/media/"):
                ext = _ext(info.filename)
                media[ext] += 1
                media_bytes[ext] += info.file_size
        inv["media"] = dict(sorted(media.items()))

        inv["chart_parts"] = len([n for n in names if re.match(r"ppt/charts/chart[^/]*\.xml$", n)])
        inv["chartex_parts"] = len([n for n in names if re.match(r"ppt/charts/chartEx[^/]*\.xml$", n)])
        inv["smartart_parts"] = len([n for n in names if re.match(r"ppt/diagrams/data[^/]*\.xml$", n)])
        inv["vml_parts"] = len([n for n in names if n.lower().endswith(".vml")])
        inv["embeddings"] = dict(
            sorted(
                collections.Counter(
                    _ext(n) for n in names if n.startswith("ppt/embeddings/")
                ).items()
            )
        )
        inv["comment_parts"] = len([n for n in names if re.match(r"ppt/comments/[^/]+\.xml$", n)])
        inv["custom_xml"] = len([n for n in names if n.startswith("customXml/") and n.endswith(".xml") and "/_rels/" not in n])
        inv["has_vba"] = any(n.lower().endswith("vbaproject.bin") for n in names)
        inv["has_thumbnail"] = any(n.startswith("docProps/thumbnail") for n in names)
        inv["tags_parts"] = len([n for n in names if re.match(r"ppt/tags/[^/]+\.xml$", n)])

        chart_types = collections.Counter()
        for n in names:
            if re.match(r"ppt/charts/chart[^/]*\.xml$", n):
                root = _parse(zf, n)
                if root is None:
                    continue
                plot = root.find(".//c:plotArea", NS)
                if plot is None:
                    continue
                for child in plot:
                    ln = _local(child.tag)
                    if ln.endswith("Chart"):
                        chart_types[ln] += 1
        inv["chart_types"] = dict(sorted(chart_types.items()))
        chartex_types = collections.Counter()
        for n in names:
            if re.match(r"ppt/charts/chartEx[^/]*\.xml$", n):
                root = _parse(zf, n)
                if root is not None:
                    for ser in root.iter("{http://schemas.microsoft.com/office/drawing/2014/chartex}series"):
                        chartex_types[ser.get("layoutId", "?")] += 1
        inv["chartex_types"] = dict(sorted(chartex_types.items()))

        smartart_layouts = []
        for n in names:
            if re.match(r"ppt/diagrams/layout[^/]*\.xml$", n):
                root = _parse(zf, n)
                if root is not None:
                    smartart_layouts.append(root.get("uniqueId") or "?")
        inv["smartart_layouts"] = sorted(set(smartart_layouts))

        # --- DrawingML counters over slides + layouts + masters ---------------
        hidden = []
        counts = collections.Counter()
        prst = collections.Counter()
        typefaces = collections.Counter()
        theme_fonts: dict[str, Any] = {}
        max_group_depth = 0
        transitions = collections.Counter()
        placeholders = collections.Counter()
        bullets = collections.Counter()
        hyperlinks = 0

        def scan(part: str, root, scope: str) -> None:
            nonlocal max_group_depth, hyperlinks
            for el in root.iter():
                tag = el.tag
                if not isinstance(tag, str):
                    continue
                ln = _local(tag)
                ns = tag[1:].split("}")[0] if tag.startswith("{") else ""
                if ns == NS["a"]:
                    if ln == "prstGeom":
                        prst[el.get("prst", "?")] += 1
                    elif ln == "custGeom":
                        counts["custGeom"] += 1
                    elif ln in ("gradFill", "pattFill", "blipFill", "grpFill", "noFill", "solidFill"):
                        counts[ln] += 1
                        if ln == "gradFill":
                            if el.find("a:path", NS) is not None:
                                counts["gradFill_path"] += 1
                            else:
                                counts["gradFill_linear"] += 1
                    elif ln in ("outerShdw", "innerShdw", "prstShdw", "glow", "softEdge", "reflection", "blur", "fillOverlay"):
                        counts[ln] += 1
                    elif ln in ("scene3d", "sp3d"):
                        counts["3d_" + ln] += 1
                    elif ln == "tbl":
                        counts["tables"] += 1
                    elif ln == "latin":
                        tf = el.get("typeface")
                        if tf:
                            typefaces[tf] += 1
                    elif ln == "normAutofit":
                        counts["normAutofit"] += 1
                    elif ln == "spAutoFit":
                        counts["spAutoFit"] += 1
                    elif ln == "bodyPr":
                        vert = el.get("vert")
                        if vert and vert != "horz":
                            counts["vertical_text"] += 1
                        if el.get("numCol") and el.get("numCol") != "1":
                            counts["text_columns"] += 1
                        if el.get("wrap") == "none":
                            counts["wrap_none"] += 1
                    elif ln in ("buAutoNum", "buChar", "buBlip"):
                        bullets[ln] += 1
                    elif ln in ("hlinkClick", "hlinkMouseOver"):
                        hyperlinks += 1
                    elif ln == "xfrm":
                        if el.get("rot") and el.get("rot") != "0":
                            counts["rotated"] += 1
                        if el.get("flipH") == "1" or el.get("flipV") == "1":
                            counts["flipped"] += 1
                    elif ln == "srcRect" and len(el.attrib):
                        counts["cropped_blip"] += 1
                    elif ln in ("grayscl", "biLevel", "duotone", "lum", "alphaModFix", "clrChange", "tint"):
                        if el.getparent() is not None and _local(el.getparent().tag) == "blip":
                            counts["blip_effect_" + ln] += 1
                    elif ln == "audioFile" or ln == "videoFile" or ln == "quickTimeFile":
                        counts["media_" + ln] += 1
                elif ns == NS["p"]:
                    if ln == "grpSp":
                        counts["grpSp"] += 1
                        max_group_depth = max(max_group_depth, _group_depth(el) + 1)
                    elif ln == "pic":
                        counts["pictures"] += 1
                    elif ln == "cxnSp":
                        counts["connectors"] += 1
                    elif ln == "sp":
                        counts["shapes"] += 1
                    elif ln == "graphicFrame":
                        counts["graphicFrames"] += 1
                    elif ln == "oleObj":
                        # PowerPoint 2010+ writes each OLE frame twice (mc:Choice + mc:Fallback); count it once.
                        if any(_local(a.tag) == "Fallback" for a in el.iterancestors()):
                            continue
                        counts["ole_objects"] += 1
                        prog = el.get("progId") or "?"
                        counts["ole:" + prog] += 1
                    elif ln == "control":
                        counts["activex_controls"] += 1
                    elif ln == "ph":
                        placeholders[el.get("type", "body")] += 1
                    elif ln == "transition":
                        if len(el):
                            transitions[_local(el[0].tag)] += 1
                        else:
                            transitions["(none)"] += 1
                    elif ln == "timing":
                        counts["animations"] += 1
                    elif ln == "clrMapOvr":
                        if el.find("a:overrideClrMapping", NS) is not None:
                            counts["clrMapOvr_override"] += 1
                    elif ln == "bg":
                        counts["background_" + scope] += 1
                    elif ln == "style":
                        counts["style_refs"] += 1
                elif ns == NS["asvg"] and ln == "svgBlip":
                    counts["svgBlip"] += 1
                elif ns == NS["dgm"] and ln == "relIds":
                    counts["smartart_frames"] += 1
                elif ns == NS["c"] and ln == "chart":
                    counts["chart_frames"] += 1
                elif ns == NS["mc"] and ln == "AlternateContent":
                    counts["alternate_content"] += 1

        for idx, part in enumerate(slide_parts, start=1):
            root = _parse(zf, part)
            if root is None:
                counts["unparseable_parts"] += 1
                continue
            if root.get("show") == "0":
                hidden.append(idx)
            scan(part, root, "slide")
        # Only layouts/masters reachable from slides can affect rendering.
        used_layouts = sorted({_resolve(sp, r["target"]) for sp in slide_parts for r in _rels(zf, sp) if r["type"] == RT_LAYOUT})
        used_masters = sorted({_resolve(lp, r["target"]) for lp in used_layouts for r in _rels(zf, lp) if r["type"] == RT_MASTER})
        inv["layouts_used"] = len(used_layouts)
        for part in used_layouts:
            root = _parse(zf, part)
            if root is not None:
                scan(part, root, "layout")
        for part in used_masters:
            root = _parse(zf, part)
            if root is not None:
                scan(part, root, "master")

        for part in themes[:1]:
            root = _parse(zf, part)
            if root is None:
                continue
            maj = root.find(".//a:fontScheme/a:majorFont/a:latin", NS)
            mnr = root.find(".//a:fontScheme/a:minorFont/a:latin", NS)
            theme_fonts = {
                "major": maj.get("typeface") if maj is not None else None,
                "minor": mnr.get("typeface") if mnr is not None else None,
            }
            name = root.get("name")
            inv["theme_name"] = name

        inv["hidden_slides"] = hidden
        inv["max_group_depth"] = max_group_depth
        inv["counts"] = dict(sorted(counts.items()))
        inv["preset_geometries"] = dict(sorted(prst.items(), key=lambda kv: (-kv[1], kv[0])))
        inv["theme_fonts"] = theme_fonts
        inv["latin_typefaces"] = dict(sorted(typefaces.items(), key=lambda kv: (-kv[1], kv[0])))
        inv["bullets"] = dict(sorted(bullets.items()))
        inv["placeholders"] = dict(sorted(placeholders.items()))
        inv["transitions"] = dict(sorted(transitions.items()))
        inv["hyperlinks"] = hyperlinks
        inv["parts"] = len(names)
        inv["media_bytes"] = dict(sorted(media_bytes.items()))
        inv["missing_slide_parts"] = [p for p in slide_parts if p not in name_set]
    return inv


def feature_tags(inv: dict[str, Any]) -> list[str]:
    """Condense an inventory into manifest feature tags."""
    c = inv.get("counts", {})
    tags: set[str] = set()
    for ext in inv.get("media", {}):
        if ext in ("png", "jpeg", "gif", "bmp", "tiff", "emf", "wmf", "svg", "wdp", "jxr"):
            tags.add(ext)
        elif ext in ("mp4", "m4v", "wmv", "avi", "mov", "mpg", "mpeg"):
            tags.add("video")
        elif ext in ("wav", "mp3", "m4a", "wma", "mid"):
            tags.add("audio")
    if "pdf" in inv.get("media", {}):
        tags.add("pdf-image")
    if inv.get("chart_parts"):
        tags.add("chart")
    if any("3D" in t for t in inv.get("chart_types", {})):
        tags.add("3d-chart")
    if inv.get("chartex_parts"):
        tags.add("chartex")
    if inv.get("smartart_parts"):
        tags.add("smartart")
    if c.get("tables"):
        tags.add("table")
    if c.get("ole_objects"):
        tags.add("ole")
    if inv.get("vml_parts"):
        tags.add("vml")
    if c.get("grpSp"):
        tags.add("group")
    if inv.get("max_group_depth", 0) >= 2:
        tags.add("nested-group")
    if c.get("custGeom"):
        tags.add("custgeom")
    if c.get("gradFill"):
        tags.add("gradient")
    if c.get("gradFill_path"):
        tags.add("path-gradient")
    if c.get("pattFill"):
        tags.add("pattern-fill")
    if c.get("blipFill", 0) > c.get("pictures", 0):
        tags.add("picture-fill")
    if c.get("outerShdw") or c.get("innerShdw") or c.get("prstShdw"):
        tags.add("shadow")
    if c.get("glow"):
        tags.add("glow")
    if c.get("softEdge"):
        tags.add("soft-edge")
    if c.get("reflection"):
        tags.add("reflection")
    if c.get("3d_sp3d") or c.get("3d_scene3d"):
        tags.add("3d")
    if c.get("connectors"):
        tags.add("connector")
    if c.get("rotated"):
        tags.add("rotation")
    if c.get("flipped"):
        tags.add("flip")
    if c.get("cropped_blip"):
        tags.add("crop")
    if any(k.startswith("blip_effect_") for k in c):
        tags.add("blip-effects")
    if c.get("svgBlip"):
        tags.add("svg-blip")
    if c.get("normAutofit"):
        tags.add("autofit")
    if c.get("vertical_text"):
        tags.add("vertical-text")
    if c.get("text_columns"):
        tags.add("text-columns")
    if inv.get("bullets", {}).get("buAutoNum"):
        tags.add("autonumber")
    if inv.get("bullets", {}).get("buBlip"):
        tags.add("picture-bullet")
    if inv.get("hidden_slides"):
        tags.add("hidden-slide")
    if inv.get("notes_slides"):
        tags.add("notes")
    if inv.get("sections"):
        tags.add("sections")
    if inv.get("hyperlinks"):
        tags.add("hyperlink")
    if inv.get("embedded_fonts"):
        tags.add("embedded-font")
    if inv.get("comment_parts"):
        tags.add("comments")
    if c.get("animations"):
        tags.add("animation")
    if c.get("clrMapOvr_override"):
        tags.add("clrmap-override")
    if c.get("style_refs"):
        tags.add("style-refs")
    if c.get("background_slide"):
        tags.add("slide-background")
    if inv.get("masters", 0) > 1:
        tags.add("multi-master")
    if c.get("activex_controls"):
        tags.add("activex")
    if inv.get("has_vba"):
        tags.add("vba")
    if c.get("alternate_content"):
        tags.add("alternate-content")
    size = inv.get("slide_size", {}).get("name", "")
    if size.startswith("4:3 ("):
        tags.add("4:3")
    elif size.startswith("16:9"):
        tags.add("16:9")
    elif size:
        tags.add("size:" + size.split(" ")[0].lower().replace(":", "x"))
    return sorted(tags)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--tags", action="store_true", help="print only the feature tags")
    args = ap.parse_args(argv)
    out = []
    rc = 0
    for f in args.files:
        try:
            inv = inspect(f)
            inv["feature_tags"] = feature_tags(inv)
        except (zipfile.BadZipFile, OSError) as e:
            inv = {"file": f, "error": str(e)}
            rc = 1
        out.append({"file": f, "feature_tags": inv.get("feature_tags")} if args.tags else inv)
    json.dump(out[0] if len(out) == 1 else out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
