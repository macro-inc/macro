"""DrawingML / PresentationML snippet builders and package post-processing.

The builders return XML *strings* (without namespace declarations); `Slide.add()`
wraps them with the standard declarations and parses them with python-pptx's
parser so the resulting elements are first-class python-pptx oxml objects.

Element order matters to PowerPoint (it validates against the schema). The
builders emit children in ECMA-376 sequence order, e.g.
  a:rPr  : ln, fill, effectLst, highlight, uLn*, uFill*, latin, ea, cs, sym, hlinkClick
  a:pPr  : lnSpc, spcBef, spcAft, buClr*, buSz*, buFont*, bullet, tabLst, defRPr
  p:spPr : xfrm, geometry, fill, ln, effectLst, scene3d, sp3d
"""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from xml.sax.saxutils import escape as _esc

from pptx.oxml import parse_xml

EMU_PER_INCH = 914400
EMU_PER_PT = 12700

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    "a14": "http://schemas.microsoft.com/office/drawing/2010/main",
    "asvg": "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
}
NSDECL = " ".join(f'xmlns:{k}="{NS[k]}"' for k in ("a", "p", "r"))

FIXED_TIMESTAMP = "2024-01-01T00:00:00Z"
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
GUID_NS = uuid.UUID("6f1d3f0c-2b56-4d1e-9a3b-6d0a4c1e7a21")


def guid(name: str) -> str:
    """Deterministic {GUID} for fields, sections, etc."""
    return "{" + str(uuid.uuid5(GUID_NS, name)).upper() + "}"


def inch(v: float) -> int:
    return int(round(v * EMU_PER_INCH))


def pt(v: float) -> int:
    return int(round(v * EMU_PER_PT))


def esc(s: str) -> str:
    return _esc(s, {'"': "&quot;"})


def attrs(**kw) -> str:
    out = []
    for k, v in kw.items():
        if v is None or v is False:
            continue
        k = k.rstrip("_").replace("__", ":")
        if v is True:
            v = "1"
        out.append(f' {k}="{esc(str(v))}"')
    return "".join(out)


def parse(xml: str):
    """Parse a snippet that uses the a:/p:/r: prefixes (declarations added here)."""
    xml = xml.strip()
    m = re.match(r"<([\w:]+)", xml)
    assert m, xml[:80]
    tag = m.group(1)
    decl = NSDECL
    for extra in ("c", "p14", "a14", "asvg"):
        if f"{extra}:" in xml and f"xmlns:{extra}=" not in xml:
            decl += f' xmlns:{extra}="{NS[extra]}"'
    return parse_xml(xml.replace(f"<{tag}", f"<{tag} {decl}", 1))


# ---------------------------------------------------------------------------
# Colors and fills
# ---------------------------------------------------------------------------

def clr(spec: str, *mods: str) -> str:
    """Color element. spec: 'RRGGBB' | 'scheme:accent1' | 'prst:red' | 'sys:windowText' | 'hsl:h,s,l'.

    mods: 'lumMod=75000', 'alpha=50000', 'tint=40000', 'shade=50000', 'lumOff=20000', ...
    """
    inner = "".join(f'<a:{m.split("=")[0]} val="{m.split("=")[1]}"/>' for m in mods)
    if spec.startswith("scheme:"):
        return f'<a:schemeClr val="{spec[7:]}">{inner}</a:schemeClr>'
    if spec.startswith("prst:"):
        return f'<a:prstClr val="{spec[5:]}">{inner}</a:prstClr>'
    if spec.startswith("sys:"):
        name, _, last = spec[4:].partition("/")
        return f'<a:sysClr val="{name}" lastClr="{last or "000000"}">{inner}</a:sysClr>'
    if spec.startswith("hsl:"):
        h, s, l = (int(x) for x in spec[4:].split(","))
        return f'<a:hslClr hue="{h * 60000}" sat="{s * 1000}" lum="{l * 1000}">{inner}</a:hslClr>'
    return f'<a:srgbClr val="{spec}">{inner}</a:srgbClr>'


def solid(spec: str, *mods: str) -> str:
    return f"<a:solidFill>{clr(spec, *mods)}</a:solidFill>"


NOFILL = "<a:noFill/>"


def grad(stops, ang: float | None = 90, scaled: bool | None = None, path: str | None = None,
         fill_to: tuple | None = None, tile: tuple | None = None, rot_with_shape: bool | None = None,
         flip: str | None = None) -> str:
    """stops: [(pos_percent, colorxml-or-spec)], ang in degrees (linear) or path in circle/rect/shape."""
    gs = []
    for pos, c in stops:
        cx = c if c.startswith("<") else clr(c)
        gs.append(f'<a:gs pos="{int(round(pos * 1000))}">{cx}</a:gs>')
    if path:
        ftr = ""
        if fill_to is not None:
            l, t, r, b = fill_to
            ftr = f'<a:fillToRect l="{l * 1000}" t="{t * 1000}" r="{r * 1000}" b="{b * 1000}"/>'
        shade = f'<a:path path="{path}">{ftr}</a:path>'
    else:
        shade = f'<a:lin ang="{int(round(ang * 60000))}"{attrs(scaled="1" if scaled else ("0" if scaled is False else None))}/>'
    tr = ""
    if tile is not None:
        l, t, r, b = tile
        tr = f'<a:tileRect l="{l * 1000}" t="{t * 1000}" r="{r * 1000}" b="{b * 1000}"/>'
    a = attrs(flip=flip, rotWithShape=("1" if rot_with_shape else ("0" if rot_with_shape is False else None)))
    return f"<a:gradFill{a}><a:gsLst>{''.join(gs)}</a:gsLst>{shade}{tr}</a:gradFill>"


def patt(prst: str, fg: str, bg: str) -> str:
    return f'<a:pattFill prst="{prst}"><a:fgClr>{clr(fg)}</a:fgClr><a:bgClr>{clr(bg)}</a:bgClr></a:pattFill>'


def blipfill(rid: str, mode: str = "stretch", src_rect: tuple | None = None, tile: dict | None = None,
             blip_inner: str = "", rot_with_shape: bool = True, tag: str = "a:blipFill") -> str:
    sr = ""
    if src_rect is not None:
        l, t, r, b = src_rect
        sr = "<a:srcRect" + attrs(l=_pct(l), t=_pct(t), r=_pct(r), b=_pct(b)) + "/>"
    if mode == "tile":
        tile = tile or {}
        how = "<a:tile" + attrs(**{k: v for k, v in tile.items()}) + "/>"
    else:
        how = "<a:stretch><a:fillRect/></a:stretch>"
    rws = ' rotWithShape="1"' if rot_with_shape else ""
    return f'<{tag}{rws}><a:blip r:embed="{rid}">{blip_inner}</a:blip>{sr}{how}</{tag}>'


def _pct(v):
    if v is None or v == 0:
        return None
    return str(int(round(v * 1000)))


# ---------------------------------------------------------------------------
# Lines and effects
# ---------------------------------------------------------------------------

def ln(w_pt: float | None = 1.0, fill: str | None = None, dash: str | None = None, cap: str | None = None,
       cmpd: str | None = None, join: str | None = None, head: tuple | None = None, tail: tuple | None = None,
       algn: str | None = None, cust_dash: list | None = None, miter_lim: int | None = None) -> str:
    """fill: xml (solid/grad/noFill) or color spec. head/tail: (type, w, len)."""
    if fill is None:
        f = ""
    elif fill.startswith("<"):
        f = fill
    else:
        f = solid(fill)
    d = ""
    if cust_dash:
        d = "<a:custDash>" + "".join(f'<a:ds d="{a * 1000}" sp="{b * 1000}"/>' for a, b in cust_dash) + "</a:custDash>"
    elif dash:
        d = f'<a:prstDash val="{dash}"/>'
    j = ""
    if join == "round":
        j = "<a:round/>"
    elif join == "bevel":
        j = "<a:bevel/>"
    elif join == "miter":
        j = f'<a:miter lim="{miter_lim or 800000}"/>'
    he = te = ""
    if head:
        he = "<a:headEnd" + attrs(type=head[0], w=head[1] if len(head) > 1 else None, len=head[2] if len(head) > 2 else None) + "/>"
    if tail:
        te = "<a:tailEnd" + attrs(type=tail[0], w=tail[1] if len(tail) > 1 else None, len=tail[2] if len(tail) > 2 else None) + "/>"
    a = attrs(w=pt(w_pt) if w_pt is not None else None, cap=cap, cmpd=cmpd, algn=algn)
    return f"<a:ln{a}>{f}{d}{j}{he}{te}</a:ln>"


def outer_shdw(blur=4, dist=3, dir_=45, color="000000", alpha=40, sx=None, sy=None, kx=None, ky=None,
               algn=None, rot_with_shape=None) -> str:
    a = attrs(blurRad=pt(blur), dist=pt(dist), dir=int(dir_ * 60000), sx=sx and int(sx * 1000),
              sy=sy and int(sy * 1000), kx=kx and int(kx * 60000), ky=ky and int(ky * 60000), algn=algn,
              rotWithShape=("1" if rot_with_shape else ("0" if rot_with_shape is False else None)))
    return f"<a:outerShdw{a}>{clr(color, f'alpha={alpha * 1000}')}</a:outerShdw>"


def inner_shdw(blur=6, dist=4, dir_=45, color="000000", alpha=50) -> str:
    return (f'<a:innerShdw blurRad="{pt(blur)}" dist="{pt(dist)}" dir="{int(dir_ * 60000)}">'
            f"{clr(color, f'alpha={alpha * 1000}')}</a:innerShdw>")


def glow(rad=8, color="FFC000", alpha=60) -> str:
    return f'<a:glow rad="{pt(rad)}">{clr(color, f"alpha={alpha * 1000}")}</a:glow>'


def soft_edge(rad=6) -> str:
    return f'<a:softEdge rad="{pt(rad)}"/>'


def reflection(blur=0.5, st_a=52, end_a=300, end_pos=35, dist=0, dir_=5400000, sy=-100, algn="bl") -> str:
    return (f'<a:reflection blurRad="{pt(blur)}" stA="{st_a * 1000}" endA="{end_a}" endPos="{end_pos * 1000}"'
            f' dist="{pt(dist)}" dir="{dir_}" sy="{sy * 1000}" algn="{algn}" rotWithShape="0"/>')


def effect_lst(*parts: str) -> str:
    """Children must be in schema order: blur, fillOverlay, glow, innerShdw, outerShdw, prstShdw, reflection, softEdge."""
    order = ["blur", "fillOverlay", "glow", "innerShdw", "outerShdw", "prstShdw", "reflection", "softEdge"]
    parts_sorted = sorted(parts, key=lambda s: order.index(re.match(r"<a:(\w+)", s).group(1)))
    return "<a:effectLst>" + "".join(parts_sorted) + "</a:effectLst>"


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def rpr(tag: str = "a:rPr", lang: str = "en-US", sz: float | None = None, b: bool | None = None,
        i: bool | None = None, u: str | None = None, strike: str | None = None, kern: float | None = None,
        cap: str | None = None, spc: float | None = None, baseline: int | None = None,
        fill: str | None = None, line: str | None = None, effects: str | None = None,
        highlight: str | None = None, u_ln: str | None = None, u_fill: str | None = None,
        latin: str | None = None, ea: str | None = None, cs: str | None = None, sym: str | None = None,
        hlink: str | None = None, dirty: bool = False, alt_lang: str | None = None) -> str:
    """Run properties. fill is xml or color spec; sz/kern/spc in points; baseline in percent."""
    a = attrs(lang=lang, altLang=alt_lang, sz=(int(round(sz * 100)) if sz is not None else None),
              b=("1" if b else ("0" if b is False else None)), i=("1" if i else ("0" if i is False else None)),
              u=u, strike=strike, kern=(int(round(kern * 100)) if kern is not None else None), cap=cap,
              spc=(int(round(spc * 100)) if spc is not None else None),
              baseline=(int(baseline * 1000) if baseline is not None else None),
              dirty=("0" if not dirty else None))
    kids = ""
    if line:
        kids += line
    if fill:
        kids += fill if fill.startswith("<") else solid(fill)
    if effects:
        kids += effects
    if highlight:
        kids += f"<a:highlight>{clr(highlight)}</a:highlight>"
    if u_ln:
        kids += u_ln
    if u_fill:
        kids += f"<a:uFill>{u_fill if u_fill.startswith('<') else solid(u_fill)}</a:uFill>"
    for nm, tf in (("latin", latin), ("ea", ea), ("cs", cs), ("sym", sym)):
        if tf:
            kids += f'<a:{nm} typeface="{esc(tf)}"/>'
    if hlink:
        kids += hlink
    return f"<{tag}{a}>{kids}</{tag}>" if kids else f"<{tag}{a}/>"


def r(text: str, **kw) -> str:
    return f"<a:r>{rpr(**kw)}<a:t>{esc(text)}</a:t></a:r>"


def br(**kw) -> str:
    return f"<a:br>{rpr(**kw)}</a:br>"


def fld(ftype: str, text: str, key: str, **kw) -> str:
    return f'<a:fld id="{guid(key)}" type="{ftype}">{rpr(**kw)}<a:t>{esc(text)}</a:t></a:fld>'


def bullet_char(ch: str, font: str | None = None, color: str | None = None, size_pct: int | None = None,
                size_pts: float | None = None, charset: int | None = None, pitch: int | None = None) -> str:
    out = ""
    if color:
        out += f"<a:buClr>{clr(color)}</a:buClr>"
    if size_pct:
        out += f'<a:buSzPct val="{size_pct * 1000}"/>'
    elif size_pts:
        out += f'<a:buSzPts val="{int(size_pts * 100)}"/>'
    if font:
        out += "<a:buFont" + attrs(typeface=font, pitchFamily=pitch, charset=charset) + "/>"
    out += f'<a:buChar char="{esc(ch)}"/>'
    return out


def bullet_auto(scheme: str, start: int | None = None, font: str | None = None, color: str | None = None,
                size_pct: int | None = None) -> str:
    out = ""
    if color:
        out += f"<a:buClr>{clr(color)}</a:buClr>"
    if size_pct:
        out += f'<a:buSzPct val="{size_pct * 1000}"/>'
    if font:
        out += f'<a:buFont typeface="{font}"/>'
    out += "<a:buAutoNum" + attrs(type=scheme, startAt=start) + "/>"
    return out


BU_NONE = "<a:buNone/>"


def p(*runs: str, algn: str | None = None, lvl: int | None = None, mar_l: float | None = None,
      indent: float | None = None, rtl: bool | None = None, ln_spc: tuple | None = None,
      spc_bef: tuple | None = None, spc_aft: tuple | None = None, bullet: str | None = None,
      tabs: list | None = None, def_rpr: str | None = None, end: str | None = None,
      font_algn: str | None = None, def_tab_sz: float | None = None, latin_ln_brk: bool | None = None) -> str:
    """Paragraph. mar_l/indent in inches; ln_spc/spc_*: ('pct', 150) | ('pts', 12)."""

    def spacing(tag, v):
        if v is None:
            return ""
        kind, val = v
        if kind == "pct":
            return f'<a:{tag}><a:spcPct val="{int(val * 1000)}"/></a:{tag}>'
        return f'<a:{tag}><a:spcPts val="{int(val * 100)}"/></a:{tag}>'

    a = attrs(marL=(inch(mar_l) if mar_l is not None else None), lvl=lvl,
              indent=(inch(indent) if indent is not None else None), algn=algn,
              defTabSz=(inch(def_tab_sz) if def_tab_sz is not None else None),
              rtl=("1" if rtl else ("0" if rtl is False else None)), fontAlgn=font_algn,
              latinLnBrk=("1" if latin_ln_brk else None))
    kids = spacing("lnSpc", ln_spc) + spacing("spcBef", spc_bef) + spacing("spcAft", spc_aft)
    if bullet:
        kids += bullet
    if tabs:
        kids += "<a:tabLst>" + "".join(f'<a:tab pos="{inch(pos)}" algn="{al}"/>' for pos, al in tabs) + "</a:tabLst>"
    if def_rpr:
        kids += def_rpr
    ppr = ""
    if a or kids:
        ppr = f"<a:pPr{a}>{kids}</a:pPr>" if kids else f"<a:pPr{a}/>"
    endp = end if end is not None else '<a:endParaRPr lang="en-US" dirty="0"/>'
    return f"<a:p>{ppr}{''.join(runs)}{endp}</a:p>"


def body(*paras: str, anchor: str | None = None, wrap: str | None = None, ins: tuple | None = None,
         vert: str | None = None, rot: float | None = None, num_col: int | None = None,
         spc_col: float | None = None, autofit: str | tuple | None = None, anchor_ctr: bool | None = None,
         upright: bool | None = None, rtl_col: bool | None = None, vert_overflow: str | None = None,
         horz_overflow: str | None = None, lst_style: str = "", warp: str | None = None,
         tag: str = "p:txBody") -> str:
    """Text body. ins = (l, t, r, b) inches; autofit: 'none' | 'shape' | ('norm', fontScale%, lnSpcReduction%)."""
    a = attrs(rot=(int(rot * 60000) if rot is not None else None), vertOverflow=vert_overflow,
              horzOverflow=horz_overflow, vert=vert, wrap=wrap,
              lIns=inch(ins[0]) if ins else None, tIns=inch(ins[1]) if ins else None,
              rIns=inch(ins[2]) if ins else None, bIns=inch(ins[3]) if ins else None,
              numCol=num_col, spcCol=(inch(spc_col) if spc_col is not None else None),
              rtlCol=("1" if rtl_col else None), anchor=anchor,
              anchorCtr=("1" if anchor_ctr else ("0" if anchor_ctr is False else None)),
              upright=("1" if upright else None))
    kids = ""
    if warp:
        kids += f'<a:prstTxWarp prst="{warp}"><a:avLst/></a:prstTxWarp>'
    if autofit == "none":
        kids += "<a:noAutofit/>"
    elif autofit == "shape":
        kids += "<a:spAutoFit/>"
    elif isinstance(autofit, tuple):
        _, fs, lr = autofit
        kids += "<a:normAutofit" + attrs(fontScale=(int(fs * 1000) if fs else None), lnSpcReduction=(int(lr * 1000) if lr else None)) + "/>"
    bp = f"<a:bodyPr{a}>{kids}</a:bodyPr>" if kids else f"<a:bodyPr{a}/>"
    ls = lst_style or "<a:lstStyle/>"
    return f"<{tag}>{bp}{ls}{''.join(paras) or '<a:p/>'}</{tag}>"


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

def xfrm(x, y, cx, cy, rot=None, flip_h=False, flip_v=False, tag="a:xfrm", ch=None) -> str:
    x, y, cx, cy = (int(round(v)) for v in (x, y, cx, cy))
    if ch is not None:
        ch = tuple(int(round(v)) for v in ch)
    a = attrs(rot=(int(round(rot * 60000)) if rot else None), flipH=bool(flip_h), flipV=bool(flip_v))
    chx = ""
    if ch is not None:
        chx = f'<a:chOff x="{ch[0]}" y="{ch[1]}"/><a:chExt cx="{ch[2]}" cy="{ch[3]}"/>'
    return f'<{tag}{a}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/>{chx}</{tag}>'


def prst_geom(prst: str, av: dict | None = None) -> str:
    gds = "".join(f'<a:gd name="{k}" fmla="val {v}"/>' for k, v in (av or {}).items())
    return f'<a:prstGeom prst="{prst}"><a:avLst>{gds}</a:avLst></a:prstGeom>'


def sp(sid: int, name: str, x: int, y: int, cx: int, cy: int, geom: str = "rect", av: dict | None = None,
       cust: str | None = None, fill: str | None = None, line: str | None = None, effects: str | None = None,
       scene3d: str | None = None, sp3d: str | None = None, rot: float | None = None, flip_h: bool = False,
       flip_v: bool = False, text: str | None = None, style: str | None = None, txbox: bool = False,
       ph: str | None = None, descr: str | None = None, hlink: str | None = None, no_xfrm: bool = False) -> str:
    cnv = f'<p:cNvPr id="{sid}" name="{esc(name)}"{attrs(descr=descr)}>{hlink}</p:cNvPr>' if hlink else \
        f'<p:cNvPr id="{sid}" name="{esc(name)}"{attrs(descr=descr)}/>'
    cnvsp = '<p:cNvSpPr txBox="1"/>' if txbox else ('<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' if ph else "<p:cNvSpPr/>")
    nvpr = f"<p:nvPr>{ph}</p:nvPr>" if ph else "<p:nvPr/>"
    geom_xml = "" if (ph and not cust and geom is None) else (cust or prst_geom(geom, av))
    xf = "" if no_xfrm else xfrm(x, y, cx, cy, rot, flip_h, flip_v)
    sppr = f"<p:spPr>{xf}{geom_xml}{fill or ''}{line or ''}{effects or ''}{scene3d or ''}{sp3d or ''}</p:spPr>"
    return f"<p:sp><p:nvSpPr>{cnv}{cnvsp}{nvpr}</p:nvSpPr>{sppr}{style or ''}{text or ''}</p:sp>"


def cxn(sid: int, name: str, x: int, y: int, cx: int, cy: int, geom: str = "straightConnector1",
        st: tuple | None = None, end: tuple | None = None, line: str | None = None, rot: float | None = None,
        flip_h: bool = False, flip_v: bool = False, av: dict | None = None, style: str | None = None) -> str:
    stx = f'<a:stCxn id="{st[0]}" idx="{st[1]}"/>' if st else ""
    enx = f'<a:endCxn id="{end[0]}" idx="{end[1]}"/>' if end else ""
    inner = f"<p:cNvCxnSpPr>{stx}{enx}</p:cNvCxnSpPr>" if (stx or enx) else "<p:cNvCxnSpPr/>"
    sppr = f"<p:spPr>{xfrm(x, y, cx, cy, rot, flip_h, flip_v)}{prst_geom(geom, av)}{line or ''}</p:spPr>"
    return (f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/>{inner}<p:nvPr/></p:nvCxnSpPr>'
            f"{sppr}{style or ''}</p:cxnSp>")


def pic(sid: int, name: str, rid: str, x: int, y: int, cx: int, cy: int, src_rect: tuple | None = None,
        blip_inner: str = "", geom: str = "rect", av: dict | None = None, line: str | None = None,
        effects: str | None = None, rot: float | None = None, flip_h: bool = False, flip_v: bool = False,
        tile: dict | None = None, descr: str | None = None) -> str:
    bf = blipfill(rid, "tile" if tile is not None else "stretch", src_rect, tile, blip_inner, rot_with_shape=True,
                  tag="p:blipFill")
    sppr = f"<p:spPr>{xfrm(x, y, cx, cy, rot, flip_h, flip_v)}{prst_geom(geom, av)}{line or ''}{effects or ''}</p:spPr>"
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{esc(name)}"{attrs(descr=descr or name)}/>'
            f'<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>{bf}{sppr}</p:pic>')


def grp(sid: int, name: str, x: int, y: int, cx: int, cy: int, ch: tuple, children: str, rot: float | None = None,
        flip_h: bool = False, flip_v: bool = False, fill: str | None = None, effects: str | None = None) -> str:
    return (f'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{sid}" name="{esc(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            f"<p:grpSpPr>{xfrm(x, y, cx, cy, rot, flip_h, flip_v, ch=ch)}{fill or ''}{effects or ''}</p:grpSpPr>"
            f"{children}</p:grpSp>")


def style_ref(ln_idx=2, fill_idx=1, effect_idx=0, font="minor", ln_clr="scheme:accent1",
              fill_clr="scheme:accent1", effect_clr="scheme:accent1", font_clr="scheme:lt1") -> str:
    def ref(tag, idx, c):
        return f'<a:{tag} idx="{idx}">{clr(c, "shade=50000") if tag == "lnRef" and c == "scheme:accent1" else clr(c)}</a:{tag}>'

    return (f"<p:style>{ref('lnRef', ln_idx, ln_clr)}{ref('fillRef', fill_idx, fill_clr)}"
            f"{ref('effectRef', effect_idx, effect_clr)}<a:fontRef idx=\"{font}\">{clr(font_clr)}</a:fontRef></p:style>")


# ---------------------------------------------------------------------------
# Package post-processing (determinism)
# ---------------------------------------------------------------------------

CORE_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" \
xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" \
xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\
<dc:title>{title}</dc:title><dc:subject>pptx_engine test corpus</dc:subject>\
<dc:creator>pptx_engine corpus generator</dc:creator><cp:keywords>{keywords}</cp:keywords>\
<dc:description>{description}</dc:description><cp:lastModifiedBy>pptx_engine corpus generator</cp:lastModifiedBy>\
<cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">{ts}</dcterms:created>\
<dcterms:modified xsi:type="dcterms:W3CDTF">{ts}</dcterms:modified></cp:coreProperties>"""

APP_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" \
xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\
<TotalTime>0</TotalTime><Application>{application}</Application>\
<PresentationFormat>{fmt}</PresentationFormat><Slides>{slides}</Slides><Notes>{notes}</Notes>\
<HiddenSlides>{hidden}</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>\
<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>\
</Properties>"""


FIELD_ID_RE = re.compile(rb'(<a:fld\b[^>]*?\bid=")\{[0-9A-Fa-f-]{36}\}(")')
AXIS_ID_RE = re.compile(rb'(<c:(?:axId|crossAx) val=")(\d+)(")')


def normalize_package(path, title: str, description: str, keywords: str, application: str | None,
                      fmt: str = "Custom", stable_field_ids: bool = False) -> None:
    """Rewrite docProps deterministically and re-zip with fixed timestamps/attributes.

    application=None keeps the existing docProps/app.xml (used for LibreOffice round trips).
    stable_field_ids replaces random a:fld/@id GUIDs and chart axis ids (LibreOffice writes new ones
    on every save).
    """
    with zipfile.ZipFile(path) as zin:
        items = [(info.filename, zin.read(info.filename)) for info in zin.infolist()]
    names = [n for n, _ in items]
    slides = [n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)]
    notes = [n for n in names if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n)]
    data = dict(items)
    hidden = sum(1 for n in slides if re.search(rb'<p:sld\b[^>]*\bshow="(0|false)"', data[n][:4000]))
    out = []
    for name, blob in items:
        if name == "docProps/core.xml":
            blob = CORE_XML.format(title=esc(title), description=esc(description), keywords=esc(keywords),
                                   ts=FIXED_TIMESTAMP).encode("utf-8")
        elif name == "docProps/app.xml" and application is not None:
            blob = APP_XML.format(application=esc(application), fmt=esc(fmt), slides=len(slides),
                                  notes=len(notes), hidden=hidden).encode("utf-8")
        elif stable_field_ids and name.endswith(".xml"):
            counter = iter(range(1_000_000))
            blob = FIELD_ID_RE.sub(lambda m: m.group(1) + guid(f"{name}#{next(counter)}").encode() + m.group(2), blob)
            if name.startswith("ppt/charts/"):
                ids: dict[bytes, bytes] = {}
                blob = AXIS_ID_RE.sub(lambda m: m.group(1) + ids.setdefault(m.group(2), str(50010001 + len(ids)).encode())
                                      + m.group(3), blob)
        out.append((name, blob))
    # [Content_Types].xml first, then the original order.
    out.sort(key=lambda kv: 0 if kv[0] == "[Content_Types].xml" else 1)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, blob in out:
            zi = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.create_system = 0
            zi.external_attr = 0
            zout.writestr(zi, blob, compresslevel=9)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
