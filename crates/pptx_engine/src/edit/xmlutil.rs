//! Small DOM helpers for edits: schema child orders, colors, fills, lookups.

use crate::error::{Error, Result};
use crate::model::shape::{alternate_content_choice, c_nv_pr, sp_tree};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of `p:spPr` / `a:spPr`.
pub const SP_PR_ORDER: &[&str] = &[
    "xfrm",
    "custGeom",
    "prstGeom",
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "ln",
    "effectLst",
    "effectDag",
    "scene3d",
    "sp3d",
    "extLst",
];
/// Child order of `a:rPr`.
pub const R_PR_ORDER: &[&str] = &[
    "ln",
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
    "effectLst",
    "effectDag",
    "highlight",
    "uLnTx",
    "uLn",
    "uFillTx",
    "uFill",
    "latin",
    "ea",
    "cs",
    "sym",
    "hlinkClick",
    "hlinkMouseOver",
    "rtl",
    "extLst",
];
/// Child order of `a:pPr`.
pub const P_PR_ORDER: &[&str] = &[
    "lnSpc",
    "spcBef",
    "spcAft",
    "buClrTx",
    "buClr",
    "buSzTx",
    "buSzPct",
    "buSzPts",
    "buFontTx",
    "buFont",
    "buNone",
    "buAutoNum",
    "buChar",
    "buBlip",
    "tabLst",
    "defRPr",
    "extLst",
];
/// Child order of `a:ln`.
pub const LN_ORDER: &[&str] = &[
    "noFill",
    "solidFill",
    "gradFill",
    "pattFill",
    "prstDash",
    "custDash",
    "round",
    "bevel",
    "miter",
    "headEnd",
    "tailEnd",
    "extLst",
];
/// Child order of `a:bodyPr`.
pub const BODY_PR_ORDER: &[&str] = &[
    "prstTxWarp",
    "noAutofit",
    "normAutofit",
    "spAutoFit",
    "scene3d",
    "sp3d",
    "flatTx",
    "extLst",
];
/// The fill-choice element names.
pub const FILL_NAMES: &[&str] = &[
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
];
/// Theme color names accepted where colors are specified.
pub const THEME_COLORS: &[&str] = &[
    "tx1", "tx2", "bg1", "bg2", "dk1", "dk2", "lt1", "lt2", "accent1", "accent2", "accent3",
    "accent4", "accent5", "accent6", "hlink", "folHlink",
];

/// Finds the shape element whose `cNvPr/@id` is `id` (searching groups).
pub fn find_shape(doc: &XmlDoc, id: u32) -> Option<NodeId> {
    let tree =
        sp_tree(doc).or_else(|| doc.children(doc.root()).find(|&c| doc.local(c) == "spTree"))?;
    let mut stack = vec![tree];
    while let Some(n) = stack.pop() {
        for c in doc.children(n) {
            if doc.local(c) == "AlternateContent" {
                // Edit the branch the renderer shows (and PowerPoint reads).
                stack.extend(alternate_content_choice(doc, c));
                continue;
            }
            if c_nv_pr(doc, c).and_then(|p| doc.attr_i64(p, "id")) == Some(i64::from(id)) {
                return Some(c);
            }
            if doc.local(c) == "grpSp" {
                stack.push(c);
            }
        }
    }
    None
}

/// The largest shape id used in a slide part.
pub fn max_shape_id(doc: &XmlDoc) -> u32 {
    doc.descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "cNvPr")
        .filter_map(|n| doc.attr_i64(n, "id"))
        .max()
        .unwrap_or(1)
        .clamp(1, i64::from(u32::MAX - 1)) as u32
}

/// An id for a new shape: one past the largest, or a random unused one when
/// the package names ids randomly (see `Package::use_random_ids`).
pub fn fresh_shape_id(doc: &XmlDoc, ids: Option<&crate::opc::IdSource>) -> u32 {
    let Some(ids) = ids else {
        return max_shape_id(doc) + 1;
    };
    let used: std::collections::HashSet<i64> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.local(n) == "cNvPr")
        .filter_map(|n| doc.attr_i64(n, "id"))
        .collect();
    loop {
        // Room above for the sequential ids a duplicated group takes.
        let id = ids.next_in(1 << 20..1 << 30) as u32;
        if !used.contains(&i64::from(id)) {
            return id;
        }
    }
}

/// The shape's properties element (`spPr` / `grpSpPr`), created if missing.
pub fn ensure_sp_pr(doc: &mut XmlDoc, shape: NodeId) -> NodeId {
    if let Some(s) = doc
        .children(shape)
        .find(|&c| matches!(doc.local(c), "spPr" | "grpSpPr"))
    {
        return s;
    }
    let ns = doc.ns(shape);
    let name = if doc.local(shape) == "grpSp" {
        "grpSpPr"
    } else {
        "spPr"
    };
    let sp_pr = doc.create_element(ns, name);
    // spPr follows the non-visual properties.
    let nv = doc
        .children(shape)
        .find(|&c| doc.local(c).starts_with("nv"));
    match nv {
        Some(nv) => doc.insert_after(nv, sp_pr),
        None => doc.insert_child(shape, 0, sp_pr),
    }
    sp_pr
}

/// Builds a color element from `RRGGBB` or a theme color name.
pub fn color_element(doc: &mut XmlDoc, color: &str, alpha: Option<f32>) -> Result<NodeId> {
    let c = color.trim().trim_start_matches('#');
    let el = if THEME_COLORS.contains(&c) {
        let e = doc.create_element(Ns::A, "schemeClr");
        doc.set_attr(e, "val", c);
        e
    } else {
        if c.len() != 6 || !c.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Err(Error::InvalidEdit(format!(
                "invalid color `{color}` (use RRGGBB or a theme color name)"
            )));
        }
        let e = doc.create_element(Ns::A, "srgbClr");
        doc.set_attr(e, "val", &c.to_ascii_uppercase());
        e
    };
    if let Some(a) = alpha.filter(|a| *a < 1.0) {
        let t = doc.create_element(Ns::A, "alpha");
        doc.set_attr(
            t,
            "val",
            &((a.clamp(0.0, 1.0) * 100_000.0).round() as i64).to_string(),
        );
        doc.append_child(el, t);
    }
    Ok(el)
}

/// Builds `<a:solidFill>` with a color.
pub fn solid_fill(doc: &mut XmlDoc, color: &str, alpha: Option<f32>) -> Result<NodeId> {
    let f = doc.create_element(Ns::A, "solidFill");
    let c = color_element(doc, color, alpha)?;
    doc.append_child(f, c);
    Ok(f)
}

/// Replaces the fill-choice child of `parent` with `fill` (inserted in `order`).
pub fn replace_fill(doc: &mut XmlDoc, parent: NodeId, fill: NodeId, order: &[&str]) {
    let old: Vec<NodeId> = doc
        .children(parent)
        .filter(|&c| doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)))
        .collect();
    for o in old {
        doc.detach(o);
    }
    doc.insert_in_order(parent, fill, order);
}

/// Writes `a:off`/`a:ext` of an `xfrm` element (points → EMU).
pub fn set_off_ext(doc: &mut XmlDoc, xfrm: NodeId, x: f32, y: f32, w: f32, h: f32) {
    let off = doc.ensure_child(xfrm, Ns::A, "off", &["off", "ext", "chOff", "chExt"]);
    doc.set_attr(off, "x", &pt_to_emu(f64::from(x)).to_string());
    doc.set_attr(off, "y", &pt_to_emu(f64::from(y)).to_string());
    let ext = doc.ensure_child(xfrm, Ns::A, "ext", &["off", "ext", "chOff", "chExt"]);
    doc.set_attr(ext, "cx", &pt_to_emu(f64::from(w.max(0.0))).to_string());
    doc.set_attr(ext, "cy", &pt_to_emu(f64::from(h.max(0.0))).to_string());
}

/// Parses an XML fragment (with the usual namespace declarations) and imports it.
pub fn import_fragment(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let wrapped = format!(
        "<w xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">{xml}</w>"
    );
    let frag = XmlDoc::parse(wrapped.as_bytes(), "fragment")?;
    let first = frag
        .first_child(frag.root())
        .ok_or_else(|| Error::InvalidEdit("empty fragment".into()))?;
    Ok(doc.import(&frag, first))
}

/// A new GUID in braces (`{8D2E61C4-...}`, as PowerPoint writes section and
/// field ids) that is not in `taken` (compared ignoring case). Random with
/// `ids` (collaborative editing, where peers must not collide); otherwise
/// derived from `seed`, so replaying an edit gives the same file.
pub fn new_guid(ids: Option<&crate::opc::IdSource>, seed: &str, taken: &[String]) -> String {
    // FNV-1a of the seed, then splitmix64 steps.
    let mut state = seed.bytes().fold(0xCBF2_9CE4_8422_2325_u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01B3)
    });
    let mut next = || match ids {
        Some(ids) => ids.next_in(0..u64::MAX),
        None => {
            state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        }
    };
    loop {
        let (hi, lo) = (next(), next());
        // Version 4 / RFC 4122 variant bits, like the GUIDs Office writes.
        let guid = format!(
            "{{{:08X}-{:04X}-{:04X}-{:04X}-{:012X}}}",
            hi >> 32,
            (hi >> 16) & 0xFFFF,
            (hi & 0x0FFF) | 0x4000,
            ((lo >> 48) & 0x3FFF) | 0x8000,
            lo & 0xFFFF_FFFF_FFFF
        );
        if !taken.iter().any(|t| t.eq_ignore_ascii_case(&guid)) {
            return guid;
        }
    }
}

/// Escapes text for XML fragments.
pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
