//! Shape operations: transforms, fills, outlines, geometry, insertion,
//! duplication, deletion, z-order, and picture replacement.

use super::ops::{FillSpec, LinePatch, NewShape, ZOrder};
use super::parts;
use super::xmlutil::{
    LN_ORDER, SP_PR_ORDER, color_element, ensure_sp_pr, esc, find_shape, import_fragment,
    max_shape_id, replace_fill, set_off_ext, solid_fill,
};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{Inherit, Xfrm, placeholder_chain, placeholder_of, sp_tree};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// Child order of `p:sp`.
const SP_ORDER: &[&str] = &["nvSpPr", "spPr", "style", "txBody", "extLst"];
/// Child order of `p:graphicFrame`.
const FRAME_ORDER: &[&str] = &["nvGraphicFramePr", "xfrm", "graphic", "extLst"];
/// Elements that occupy a z-order slot in a shape tree.
const TREE_ITEMS: &[&str] = &[
    "sp",
    "grpSp",
    "pic",
    "graphicFrame",
    "cxnSp",
    "AlternateContent",
    "contentPart",
];
/// The table style PowerPoint applies to new tables (Medium Style 2 - Accent 1).
const DEFAULT_TABLE_STYLE: &str = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
/// Arrowhead types accepted by [`LinePatch`].
const LINE_ENDS: &[&str] = &["none", "triangle", "stealth", "diamond", "oval", "arrow"];
/// Preset dashes accepted by [`LinePatch`].
const DASHES: &[&str] = &[
    "solid",
    "dot",
    "dash",
    "lgDash",
    "dashDot",
    "lgDashDot",
    "lgDashDotDot",
    "sysDash",
    "sysDot",
    "sysDashDot",
    "sysDashDotDot",
];

/// Finds a shape element by id, or fails with `NotFound`.
pub fn find(doc: &XmlDoc, id: u32) -> Result<NodeId> {
    find_shape(doc, id).ok_or_else(|| Error::NotFound(format!("shape {id}")))
}

fn is_text_box(doc: &XmlDoc, shape: NodeId) -> bool {
    doc.path(shape, Ns::P, &["nvSpPr", "cNvSpPr"])
        .and_then(|c| doc.attr_bool(c, "txBox"))
        .unwrap_or(false)
}

/// The text body of a shape, created (with PowerPoint's defaults) when absent.
pub fn ensure_tx_body(doc: &mut XmlDoc, shape: NodeId) -> Result<NodeId> {
    if let Some(b) = doc.children(shape).find(|&c| doc.local(c) == "txBody") {
        return Ok(b);
    }
    match doc.local(shape) {
        "sp" => {
            let fragment = if placeholder_of(doc, shape).is_some() {
                "<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody>"
            } else if is_text_box(doc, shape) {
                "<p:txBody><a:bodyPr wrap=\"square\" rtlCol=\"0\"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody>"
            } else {
                // Text typed into a drawn shape is centered both ways.
                "<p:txBody><a:bodyPr rtlCol=\"0\" anchor=\"ctr\"/><a:lstStyle/><a:p><a:pPr algn=\"ctr\"/><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody>"
            };
            let body = import_fragment(doc, fragment)?;
            doc.insert_in_order(shape, body, SP_ORDER);
            Ok(body)
        }
        "graphicFrame" => Err(Error::InvalidEdit(
            "table text is edited per cell (pass `cell`)".into(),
        )),
        other => Err(Error::InvalidEdit(format!(
            "a `{other}` shape cannot hold text"
        ))),
    }
}

/// Changes to a shape's transform.
#[derive(Clone, Copy, Debug, Default)]
pub struct TransformPatch {
    /// Left.
    pub x: Option<f32>,
    /// Top.
    pub y: Option<f32>,
    /// Width.
    pub w: Option<f32>,
    /// Height.
    pub h: Option<f32>,
    /// Rotation in degrees.
    pub rotation: Option<f32>,
    /// Horizontal flip.
    pub flip_h: Option<bool>,
    /// Vertical flip.
    pub flip_v: Option<bool>,
}

fn sp_pr(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape)
        .find(|&c| matches!(doc.local(c), "spPr" | "grpSpPr"))
}

fn xfrm_element(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    if doc.local(shape) == "graphicFrame" {
        doc.child(shape, Ns::P, "xfrm")
    } else {
        sp_pr(doc, shape).and_then(|s| doc.child(s, Ns::A, "xfrm"))
    }
}

/// The shape's `xfrm` element, created when missing.
pub fn ensure_xfrm(doc: &mut XmlDoc, shape: NodeId) -> NodeId {
    if doc.local(shape) == "graphicFrame" {
        return doc.ensure_child(shape, Ns::P, "xfrm", FRAME_ORDER);
    }
    let sp_pr = ensure_sp_pr(doc, shape);
    doc.ensure_child(sp_pr, Ns::A, "xfrm", SP_PR_ORDER)
}

/// The shape's transform, inherited from its layout/master placeholder when not set.
pub fn effective_xfrm(pres: &mut Presentation, part: &str, shape: u32) -> Result<Xfrm> {
    let slide = pres.part(part)?;
    let node = find(&slide.doc, shape)?;
    if let Some(x) = xfrm_element(&slide.doc, node) {
        return Ok(Xfrm::parse(&slide.doc, x));
    }
    let ctx = pres.context_for(slide.clone(), 1)?;
    let chain = placeholder_chain(&ctx, &slide, node, Inherit::Slide);
    Ok(chain
        .iter()
        .find_map(|(p, n)| xfrm_element(&p.doc, *n).map(|x| Xfrm::parse(&p.doc, x)))
        .unwrap_or_default())
}

fn check_finite(values: &[Option<f32>]) -> Result<()> {
    if values.iter().flatten().any(|v| !v.is_finite()) {
        return Err(Error::InvalidEdit("numbers must be finite".into()));
    }
    Ok(())
}

fn emu(pt: f32) -> i64 {
    pt_to_emu(f64::from(pt))
}

/// Moves, resizes, rotates, or flips a shape.
pub fn set_transform(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    patch: &TransformPatch,
) -> Result<()> {
    check_finite(&[patch.x, patch.y, patch.w, patch.h, patch.rotation])?;
    if patch.w.is_some_and(|w| w < 0.0) || patch.h.is_some_and(|h| h < 0.0) {
        return Err(Error::InvalidEdit(
            "width and height must not be negative".into(),
        ));
    }
    let current = effective_xfrm(pres, part, shape)?;
    let doc = pres.xml_mut(part)?;
    let node = find(doc, shape)?;
    let frame = doc.local(node) == "graphicFrame";
    if frame
        && (patch.rotation.is_some_and(|r| r.rem_euclid(360.0) != 0.0)
            || patch.flip_h == Some(true)
            || patch.flip_v == Some(true))
    {
        return Err(Error::InvalidEdit(
            "tables, charts, and other graphic frames cannot be rotated or flipped".into(),
        ));
    }
    let xfrm = ensure_xfrm(doc, node);
    if doc.local(node) == "grpSp" && doc.child(xfrm, Ns::A, "chOff").is_none() {
        // Pin the children's coordinate space before the group's box changes.
        let ch_off = doc.ensure_child(xfrm, Ns::A, "chOff", &["off", "ext", "chOff", "chExt"]);
        doc.set_attr(ch_off, "x", &emu(current.x).to_string());
        doc.set_attr(ch_off, "y", &emu(current.y).to_string());
        let ch_ext = doc.ensure_child(xfrm, Ns::A, "chExt", &["off", "ext", "chOff", "chExt"]);
        doc.set_attr(ch_ext, "cx", &emu(current.w).to_string());
        doc.set_attr(ch_ext, "cy", &emu(current.h).to_string());
    }
    set_off_ext(
        doc,
        xfrm,
        patch.x.unwrap_or(current.x),
        patch.y.unwrap_or(current.y),
        patch.w.unwrap_or(current.w),
        patch.h.unwrap_or(current.h),
    );
    if let Some(r) = patch.rotation {
        let v = (f64::from(r).rem_euclid(360.0) * 60_000.0).round() as i64 % 21_600_000;
        if v == 0 {
            doc.remove_attr(xfrm, "rot");
        } else {
            doc.set_attr(xfrm, "rot", &v.to_string());
        }
    }
    for (name, value) in [("flipH", patch.flip_h), ("flipV", patch.flip_v)] {
        match value {
            Some(true) => doc.set_attr(xfrm, name, "1"),
            Some(false) => doc.remove_attr(xfrm, name),
            None => {}
        }
    }
    Ok(())
}

/// Builds a fill-choice element from a [`FillSpec`].
pub fn fill_element(doc: &mut XmlDoc, spec: &FillSpec) -> Result<NodeId> {
    match spec {
        FillSpec::None => Ok(doc.create_element(Ns::A, "noFill")),
        FillSpec::Solid { color, alpha } => solid_fill(doc, color, *alpha),
        FillSpec::Gradient { colors, angle } => {
            if colors.len() < 2 {
                return Err(Error::InvalidEdit(
                    "a gradient needs at least two colors".into(),
                ));
            }
            if !angle.is_finite() {
                return Err(Error::InvalidEdit("gradient angle must be finite".into()));
            }
            let grad = doc.create_element(Ns::A, "gradFill");
            doc.set_attr(grad, "rotWithShape", "1");
            let list = doc.create_element(Ns::A, "gsLst");
            doc.append_child(grad, list);
            let last = colors.len() - 1;
            for (i, c) in colors.iter().enumerate() {
                let gs = doc.create_element(Ns::A, "gs");
                doc.set_attr(gs, "pos", &(i * 100_000 / last).to_string());
                let color = color_element(doc, c, None)?;
                doc.append_child(gs, color);
                doc.append_child(list, gs);
            }
            let lin = doc.create_element(Ns::A, "lin");
            let ang = (f64::from(*angle).rem_euclid(360.0) * 60_000.0).round() as i64 % 21_600_000;
            doc.set_attr(lin, "ang", &ang.to_string());
            doc.set_attr(lin, "scaled", "0");
            doc.append_child(grad, lin);
            Ok(grad)
        }
    }
}

/// Sets a shape's fill.
pub fn set_fill(doc: &mut XmlDoc, shape: NodeId, spec: &FillSpec) -> Result<()> {
    if doc.local(shape) == "graphicFrame" {
        return Err(Error::InvalidEdit(
            "graphic frames (tables, charts) have no shape fill".into(),
        ));
    }
    let sp_pr = ensure_sp_pr(doc, shape);
    let fill = fill_element(doc, spec)?;
    replace_fill(doc, sp_pr, fill, SP_PR_ORDER);
    Ok(())
}

/// Changes a shape's outline.
pub fn set_line(doc: &mut XmlDoc, shape: NodeId, patch: &LinePatch) -> Result<()> {
    if matches!(doc.local(shape), "graphicFrame" | "grpSp") {
        return Err(Error::InvalidEdit("this shape has no outline".into()));
    }
    let sp_pr = ensure_sp_pr(doc, shape);
    let ln = doc.ensure_child(sp_pr, Ns::A, "ln", SP_PR_ORDER);
    if patch.none {
        let nf = doc.create_element(Ns::A, "noFill");
        replace_fill(doc, ln, nf, LN_ORDER);
        return Ok(());
    }
    if let Some(c) = &patch.color {
        let f = solid_fill(doc, c, None)?;
        replace_fill(doc, ln, f, LN_ORDER);
    } else if (patch.width.is_some() || patch.dash.is_some())
        && doc.child(ln, Ns::A, "noFill").is_some()
    {
        // Giving an invisible outline a width or dash makes it visible.
        let f = solid_fill(doc, "tx1", None)?;
        replace_fill(doc, ln, f, LN_ORDER);
    }
    if let Some(w) = patch.width {
        if !(0.0..=1584.0).contains(&w) {
            return Err(Error::InvalidEdit(format!(
                "line width {w} is out of range (0-1584 pt)"
            )));
        }
        doc.set_attr(ln, "w", &emu(w).to_string());
    }
    if let Some(d) = &patch.dash {
        if !DASHES.contains(&d.as_str()) {
            return Err(Error::InvalidEdit(format!(
                "unknown dash `{d}` (use one of {})",
                DASHES.join(", ")
            )));
        }
        doc.remove_children_named(ln, Ns::A, "custDash");
        let el = doc.ensure_child(ln, Ns::A, "prstDash", LN_ORDER);
        doc.set_attr(el, "val", d);
    }
    for (name, value) in [("headEnd", &patch.head), ("tailEnd", &patch.tail)] {
        let Some(kind) = value else { continue };
        if !LINE_ENDS.contains(&kind.as_str()) {
            return Err(Error::InvalidEdit(format!(
                "unknown arrowhead `{kind}` (use one of {})",
                LINE_ENDS.join(", ")
            )));
        }
        let el = doc.ensure_child(ln, Ns::A, name, LN_ORDER);
        doc.set_attr(el, "type", kind);
        if kind != "none" {
            doc.set_attr(el, "w", "med");
            doc.set_attr(el, "len", "med");
        }
    }
    Ok(())
}

/// Replaces a shape's geometry with a preset.
pub fn set_geometry(doc: &mut XmlDoc, shape: NodeId, preset: &str) -> Result<()> {
    if !crate::geometry::is_preset(preset) {
        return Err(Error::InvalidEdit(format!(
            "unknown preset geometry `{preset}`"
        )));
    }
    if matches!(doc.local(shape), "graphicFrame" | "grpSp") {
        return Err(Error::InvalidEdit("this shape has no geometry".into()));
    }
    let sp_pr = ensure_sp_pr(doc, shape);
    doc.remove_children_named(sp_pr, Ns::A, "prstGeom");
    doc.remove_children_named(sp_pr, Ns::A, "custGeom");
    let g = doc.create_element(Ns::A, "prstGeom");
    doc.set_attr(g, "prst", preset);
    let av = doc.create_element(Ns::A, "avLst");
    doc.append_child(g, av);
    doc.insert_in_order(sp_pr, g, SP_PR_ORDER);
    Ok(())
}

/// Paragraph markup for initial text (`\n` separates paragraphs).
fn paragraphs_xml(text: &str, ppr: &str) -> String {
    text.split('\n')
        .map(|line| {
            let runs: String = line
                .split('\u{b}')
                .enumerate()
                .map(|(i, seg)| {
                    let br = if i > 0 {
                        "<a:br><a:rPr lang=\"en-US\" dirty=\"0\"/></a:br>"
                    } else {
                        ""
                    };
                    let run = if seg.is_empty() {
                        String::new()
                    } else {
                        format!(
                            "<a:r><a:rPr lang=\"en-US\" dirty=\"0\"/><a:t>{}</a:t></a:r>",
                            esc(seg)
                        )
                    };
                    format!("{br}{run}")
                })
                .collect();
            format!("<a:p>{ppr}{runs}<a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p>")
        })
        .collect()
}

/// Human-readable names PowerPoint gives common presets.
fn preset_display_name(preset: &str) -> String {
    let known = match preset {
        "rect" => "Rectangle",
        "roundRect" => "Rectangle: Rounded Corners",
        "ellipse" => "Oval",
        "triangle" => "Isosceles Triangle",
        "rightArrow" => "Arrow: Right",
        "leftArrow" => "Arrow: Left",
        "upArrow" => "Arrow: Up",
        "downArrow" => "Arrow: Down",
        "star5" => "Star: 5 Points",
        "line" => "Straight Connector",
        _ => "",
    };
    if known.is_empty() {
        let mut s = preset.to_owned();
        if let Some(f) = s.get_mut(0..1) {
            f.make_ascii_uppercase();
        }
        s
    } else {
        known.to_owned()
    }
}

/// Appends a shape element to the top of the z-order of a shape tree.
fn append_to_tree(doc: &mut XmlDoc, tree: NodeId, el: NodeId) {
    match doc
        .children(tree)
        .last()
        .filter(|&c| doc.local(c) == "extLst")
    {
        Some(ext) => doc.insert_before(ext, el),
        None => doc.append_child(tree, el),
    }
}

/// Adds a shape; returns its id.
pub fn add_shape(
    pres: &mut Presentation,
    part: &str,
    new: &NewShape,
    rect: [f32; 4],
) -> Result<u32> {
    check_finite(&rect.map(Some))?;
    let [x, y, mut w, mut h] = rect;
    if w < 0.0 || h < 0.0 {
        return Err(Error::InvalidEdit(
            "width and height must not be negative".into(),
        ));
    }
    let id = max_shape_id(&*pres.xml(part)?) + 1;
    let n = id - 1;
    let fragment = match new {
        NewShape::TextBox { text } => {
            let xfrm = xfrm_xml(x, y, w, h);
            format!(
                "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"TextBox {n}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr><p:spPr>{xfrm}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap=\"square\" rtlCol=\"0\"><a:spAutoFit/></a:bodyPr><a:lstStyle/>{}</p:txBody></p:sp>",
                paragraphs_xml(text, "")
            )
        }
        NewShape::Shape { preset, text } => {
            if !crate::geometry::is_preset(preset) {
                return Err(Error::InvalidEdit(format!(
                    "unknown preset geometry `{preset}`"
                )));
            }
            let xfrm = xfrm_xml(x, y, w, h);
            let name = esc(&preset_display_name(preset));
            format!(
                "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name} {n}\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>{xfrm}<a:prstGeom prst=\"{}\"><a:avLst/></a:prstGeom></p:spPr><p:style><a:lnRef idx=\"2\"><a:schemeClr val=\"accent1\"><a:shade val=\"50000\"/></a:schemeClr></a:lnRef><a:fillRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"lt1\"/></a:fontRef></p:style><p:txBody><a:bodyPr rtlCol=\"0\" anchor=\"ctr\"/><a:lstStyle/>{}</p:txBody></p:sp>",
                esc(preset),
                paragraphs_xml(text, "<a:pPr algn=\"ctr\"/>")
            )
        }
        NewShape::Line { arrow } => {
            let xfrm = xfrm_xml(x, y, w, h);
            let tail = if *arrow {
                "<a:tailEnd type=\"triangle\" w=\"med\" len=\"med\"/>"
            } else {
                ""
            };
            format!(
                "<p:cxnSp><p:nvCxnSpPr><p:cNvPr id=\"{id}\" name=\"Straight Connector {n}\"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>{xfrm}<a:prstGeom prst=\"line\"><a:avLst/></a:prstGeom><a:ln w=\"19050\">{tail}</a:ln></p:spPr><p:style><a:lnRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"tx1\"/></a:fontRef></p:style></p:cxnSp>"
            )
        }
        NewShape::Image { data, description } => {
            let bytes = parts::decode_base64(data)?;
            let image = parts::add_image(pres, part, &bytes)?;
            // A zero dimension means "natural size" (96 dpi), keeping the aspect ratio.
            let (pw, ph) = (image.width as f32 * 0.75, image.height as f32 * 0.75);
            match (w == 0.0, h == 0.0) {
                (true, true) => (w, h) = (pw, ph),
                (true, false) if ph > 0.0 => w = h * pw / ph,
                (false, true) if pw > 0.0 => h = w * ph / pw,
                _ => {}
            }
            let xfrm = xfrm_xml(x, y, w, h);
            format!(
                "<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"Picture {n}\" descr=\"{}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"{}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{xfrm}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>",
                esc(description),
                esc(&image.rid)
            )
        }
        NewShape::Table { cells } => table_xml(id, n, cells, [x, y, w, h])?,
    };
    let doc = pres.xml_mut(part)?;
    let el = import_fragment(doc, &fragment)?;
    let tree = sp_tree(doc).ok_or_else(|| Error::InvalidEdit("slide has no shape tree".into()))?;
    append_to_tree(doc, tree, el);
    Ok(id)
}

fn xfrm_xml(x: f32, y: f32, w: f32, h: f32) -> String {
    format!(
        "<a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm>",
        emu(x),
        emu(y),
        emu(w.max(0.0)),
        emu(h.max(0.0))
    )
}

fn table_xml(id: u32, n: u32, cells: &[Vec<String>], [x, y, w, h]: [f32; 4]) -> Result<String> {
    let rows = cells.len();
    let cols = cells.iter().map(Vec::len).max().unwrap_or(0);
    if rows == 0 || cols == 0 {
        return Err(Error::InvalidEdit(
            "a table needs at least one row and one column".into(),
        ));
    }
    if rows > 200 || cols > 75 {
        return Err(Error::InvalidEdit(
            "tables are limited to 200 rows and 75 columns".into(),
        ));
    }
    let col_w = emu(w) / cols as i64;
    let row_h = emu(h) / rows as i64;
    let grid: String = (0..cols)
        .map(|_| format!("<a:gridCol w=\"{col_w}\"/>"))
        .collect();
    let body: String = cells
        .iter()
        .map(|row| {
            let tcs: String = (0..cols)
                .map(|c| {
                    let text = row.get(c).map_or("", String::as_str);
                    format!(
                        "<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>{}</a:txBody><a:tcPr/></a:tc>",
                        paragraphs_xml(text, "")
                    )
                })
                .collect();
            format!("<a:tr h=\"{row_h}\">{tcs}</a:tr>")
        })
        .collect();
    Ok(format!(
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Table {n}\"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl><a:tblPr firstRow=\"1\" bandRow=\"1\"><a:tableStyleId>{DEFAULT_TABLE_STYLE}</a:tableStyleId></a:tblPr><a:tblGrid>{grid}</a:tblGrid>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>",
        emu(x),
        emu(y),
        col_w * cols as i64,
        row_h * rows as i64
    ))
}

/// The element that occupies the shape's z-order slot (its `mc:AlternateContent`, if wrapped).
fn tree_item(doc: &XmlDoc, shape: NodeId) -> NodeId {
    match doc.parent(shape) {
        Some(p) if matches!(doc.local(p), "Choice" | "Fallback") => doc.parent(p).unwrap_or(shape),
        _ => shape,
    }
}

/// Deletes a shape (and a group it leaves empty).
pub fn delete_shape(doc: &mut XmlDoc, shape: NodeId) {
    let item = tree_item(doc, shape);
    let parent = doc.parent(item);
    doc.detach(item);
    if let Some(g) = parent
        && doc.local(g) == "grpSp"
        && !doc.children(g).any(|c| TREE_ITEMS.contains(&doc.local(c)))
    {
        delete_shape(doc, g);
    }
}

/// Gives every shape in a copied subtree a fresh id; returns the old → new map.
fn renumber(doc: &mut XmlDoc, root: NodeId, next: &mut u32) -> HashMap<i64, u32> {
    let mut map: HashMap<i64, u32> = HashMap::new();
    let mut nodes = vec![root];
    nodes.extend(doc.descendants(root));
    for &n in &nodes {
        if doc.local(n) != "cNvPr" {
            continue;
        }
        let old = doc.attr_i64(n, "id").unwrap_or(0);
        let new = *map.entry(old).or_insert_with(|| {
            let v = *next;
            *next += 1;
            v
        });
        doc.set_attr(n, "id", &new.to_string());
        // Creation ids identify the original shape; copies get none.
        doc.remove_children_named(n, Ns::A, "extLst");
    }
    for &n in &nodes {
        if matches!(doc.local(n), "stCxn" | "endCxn")
            && let Some(&new) = doc.attr_i64(n, "id").and_then(|old| map.get(&old))
        {
            doc.set_attr(n, "id", &new.to_string());
        }
    }
    map
}

/// Duplicates a shape, offset by `(dx, dy)` points; returns the copy's id.
pub fn duplicate_shape(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    dx: f32,
    dy: f32,
) -> Result<u32> {
    check_finite(&[Some(dx), Some(dy)])?;
    let current = effective_xfrm(pres, part, shape)?;
    let doc = pres.xml_mut(part)?;
    let node = find(doc, shape)?;
    let item = tree_item(doc, node);
    let copy = doc.deep_clone(item);
    let mut next = max_shape_id(doc) + 1;
    let map = renumber(doc, copy, &mut next);
    let new_id = *map
        .get(&i64::from(shape))
        .ok_or_else(|| Error::InvalidEdit("shape has no id".into()))?;
    let tops: Vec<NodeId> = if doc.local(copy) == "AlternateContent" {
        doc.children(copy)
            .flat_map(|branch| doc.children(branch).collect::<Vec<_>>())
            .collect()
    } else {
        vec![copy]
    };
    if dx != 0.0 || dy != 0.0 {
        for top in tops {
            let xfrm = match xfrm_element(doc, top) {
                Some(x) => x,
                None => {
                    let x = ensure_xfrm(doc, top);
                    set_off_ext(doc, x, current.x, current.y, current.w, current.h);
                    x
                }
            };
            if let Some(off) = doc.child(xfrm, Ns::A, "off") {
                let ox = doc.attr_i64(off, "x").unwrap_or(0) + emu(dx);
                let oy = doc.attr_i64(off, "y").unwrap_or(0) + emu(dy);
                doc.set_attr(off, "x", &ox.to_string());
                doc.set_attr(off, "y", &oy.to_string());
            }
        }
    }
    doc.insert_after(item, copy);
    Ok(new_id)
}

/// Changes a shape's z-order among its siblings.
pub fn reorder(doc: &mut XmlDoc, shape: NodeId, to: ZOrder) {
    let item = tree_item(doc, shape);
    let Some(parent) = doc.parent(item) else {
        return;
    };
    let siblings: Vec<NodeId> = doc
        .children(parent)
        .filter(|&c| TREE_ITEMS.contains(&doc.local(c)))
        .collect();
    let Some(i) = siblings.iter().position(|&s| s == item) else {
        return;
    };
    let last = siblings.len() - 1;
    let target = match to {
        ZOrder::Front => last,
        ZOrder::Back => 0,
        ZOrder::Forward => (i + 1).min(last),
        ZOrder::Backward => i.saturating_sub(1),
    };
    if target == i {
        return;
    }
    let others: Vec<NodeId> = siblings.into_iter().filter(|&s| s != item).collect();
    doc.detach(item);
    match others.get(target) {
        Some(&before) => doc.insert_before(before, item),
        None => match others.last() {
            Some(&after) => doc.insert_after(after, item),
            None => doc.append_child(parent, item),
        },
    }
}

/// Replaces the image of a picture (or a picture-filled shape).
pub fn replace_image(pres: &mut Presentation, part: &str, shape: u32, data: &str) -> Result<()> {
    let bytes = parts::decode_base64(data)?;
    // Validate the target before adding the image part.
    {
        let doc = pres.xml(part)?;
        let node = find(&doc, shape)?;
        if blip_fill_of(&doc, node).is_none() {
            return Err(Error::InvalidEdit(format!(
                "shape {shape} is not a picture"
            )));
        }
    }
    let image = parts::add_image(pres, part, &bytes)?;
    let doc = pres.xml_mut(part)?;
    let node = find(doc, shape)?;
    let blip_fill = blip_fill_of(doc, node)
        .ok_or_else(|| Error::InvalidEdit(format!("shape {shape} is not a picture")))?;
    let blip = match doc.child(blip_fill, Ns::A, "blip") {
        Some(b) => b,
        None => {
            let b = doc.create_element(Ns::A, "blip");
            doc.insert_child(blip_fill, 0, b);
            b
        }
    };
    doc.set_attr_ns(blip, Ns::R, "embed", &image.rid);
    doc.remove_attr_ns(blip, Ns::R, "link");
    // Extensions may carry an SVG original of the old picture.
    doc.remove_children_named(blip, Ns::A, "extLst");
    // A crop of the old picture means nothing for the new one.
    doc.remove_children_named(blip_fill, Ns::A, "srcRect");
    Ok(())
}

fn blip_fill_of(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    match doc.local(shape) {
        "pic" => doc.children(shape).find(|&c| doc.local(c) == "blipFill"),
        "sp" => sp_pr(doc, shape).and_then(|s| doc.child(s, Ns::A, "blipFill")),
        _ => None,
    }
}
