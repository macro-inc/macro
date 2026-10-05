//! Convert to Shapes (a group of ordinary shapes drawn like the diagram)
//! and Convert to Text (a bulleted text box of the nodes).

use super::data::{self, Model};
use super::{frame_of, parts_of};
use crate::edit::ops::SmartArtTarget;
use crate::edit::shapes::delete_shape;
use crate::edit::xmlutil::{find_shape, fresh_shape_id, import_fragment};
use crate::error::{Error, Result};
use crate::model::presentation::{PartRef, Presentation};
use crate::model::shape::{Inherit, WalkCtx, Xfrm, resolve_shape};
use crate::render::build::shape_geometry;
use crate::units::{emu_to_pt, pt_to_emu};
use crate::xml::{NodeId, Ns, XmlDoc};

/// The children of `node` serialized one after the other (each with the
/// namespace declarations it needs).
fn inner_xml(doc: &XmlDoc, node: NodeId) -> String {
    doc.children(node)
        .filter(|&c| doc.element(c).is_some())
        .map(|c| String::from_utf8_lossy(&doc.fragment(c).to_bytes()).into_owned())
        .collect()
}

fn emu(v: f32) -> i64 {
    pt_to_emu(f64::from(v))
}

/// Converts the SmartArt frame `shape`; returns the new shape's id.
pub(crate) fn convert(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    to: SmartArtTarget,
) -> Result<u32> {
    let (frame, _, _) = frame_of(pres, slide_part, shape)?;
    let parts = parts_of(pres, slide_part, frame)?;
    let slide = pres.xml(slide_part)?;
    let xfrm = slide
        .child(frame, Ns::P, "xfrm")
        .map(|x| Xfrm::parse(&slide, x))
        .unwrap_or_default();
    let ids = pres.pkg.ids().cloned();
    let first = fresh_shape_id(&slide, ids.as_deref());
    let xml = match to {
        SmartArtTarget::Shapes => {
            let drawing = parts
                .drawing
                .clone()
                .ok_or_else(|| Error::MissingPart("SmartArt drawing".into()))?;
            shapes_xml(pres, slide_part, &drawing, &xfrm, first)?
        }
        SmartArtTarget::Text => text_xml(pres, &parts.data, &xfrm, first)?,
    };
    let doc = pres.xml_mut(slide_part)?;
    let frame = find_shape(doc, shape).ok_or_else(|| Error::NotFound(format!("shape {shape}")))?;
    let el = import_fragment(doc, &xml)?;
    doc.insert_before(frame, el);
    delete_shape(doc, frame);
    Ok(first)
}

/// A group (id `first`) of `p:sp` shapes copied from the drawing (ids
/// `first + 1`...), at the frame's place.
fn shapes_xml(
    pres: &mut Presentation,
    slide_part: &str,
    drawing: &str,
    frame: &Xfrm,
    first: u32,
) -> Result<String> {
    let part = pres.part(drawing)?;
    let slide = pres.part(slide_part)?;
    let ctx = pres.context_for(slide, 1)?;
    let doc = &part.doc;
    let tree = doc
        .child(doc.root(), Ns::DSP, "spTree")
        .ok_or_else(|| Error::InvalidEdit("the SmartArt drawing has no shapes".into()))?;
    let walk = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Master,
    };
    let mut children = String::new();
    let sps: Vec<NodeId> = doc.children_named(tree, Ns::DSP, "sp").collect();
    for (k, &sp) in sps.iter().enumerate() {
        let id = first + 1 + k as u32;
        let sp_pr = doc
            .child(sp, Ns::DSP, "spPr")
            .map(|s| inner_xml(doc, s))
            .unwrap_or_default();
        let style = doc
            .child(sp, Ns::DSP, "style")
            .map(|s| format!("<p:style>{}</p:style>", inner_xml(doc, s)))
            .unwrap_or_default();
        let body = match doc.child(sp, Ns::DSP, "txBody") {
            Some(b) => {
                let mut frag = doc.fragment(b);
                adjust_insets(&mut frag, &walk, &part, sp);
                format!("<p:txBody>{}</p:txBody>", inner_xml(&frag, frag.root()))
            }
            None => String::new(),
        };
        let has_text = doc
            .child(sp, Ns::DSP, "txBody")
            .is_some_and(|b| !data::plain_text(doc, b).trim().is_empty());
        let name = if has_text { "Rectangle" } else { "Shape" };
        children.push_str(&format!(
            "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name} {}\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>{sp_pr}</p:spPr>{style}{body}</p:sp>",
            id - 1
        ));
    }
    let (x, y, w, h) = (emu(frame.x), emu(frame.y), emu(frame.w), emu(frame.h));
    Ok(format!(
        "<p:grpSp><p:nvGrpSpPr><p:cNvPr id=\"{first}\" name=\"Group {}\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{w}\" cy=\"{h}\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"{w}\" cy=\"{h}\"/></a:xfrm></p:grpSpPr>{children}</p:grpSp>",
        first.saturating_sub(1)
    ))
}

/// Moves a SmartArt shape's text box (`dsp:txXfrm`) into its insets, since
/// ordinary shapes place text by their geometry.
fn adjust_insets(body: &mut XmlDoc, walk: &WalkCtx<'_>, part: &PartRef, sp: NodeId) {
    let doc = &part.doc;
    let Some(tx) = doc
        .child(sp, Ns::DSP, "txXfrm")
        .map(|t| Xfrm::parse(doc, t))
    else {
        return;
    };
    let Some(shape) = resolve_shape(walk, part, sp) else {
        return;
    };
    if (tx.rot - shape.xfrm.rot).abs() > 0.01 {
        return;
    }
    let g = shape_geometry(&shape).text_rect;
    let s = shape.xfrm;
    let deltas = [
        (tx.x - s.x) - g.x,
        (tx.y - s.y) - g.y,
        (s.x + g.x + g.w) - (tx.x + tx.w),
        (s.y + g.y + g.h) - (tx.y + tx.h),
    ];
    let Some(bpr) = body.child(body.root(), Ns::A, "bodyPr") else {
        return;
    };
    // Insets default to 0.1" left and right, 0.05" top and bottom.
    let defaults = [7.2, 3.6, 7.2, 3.6];
    for ((attr, d), default) in ["lIns", "tIns", "rIns", "bIns"]
        .iter()
        .zip(deltas)
        .zip(defaults)
    {
        let current = body.attr_f64(bpr, attr).map_or(default, emu_to_pt);
        let v = (current + d).max(0.0);
        body.set_attr(bpr, attr, &emu(v).to_string());
    }
}

/// A bulleted text box (id `id`) of the nodes at the frame's place.
fn text_xml(pres: &mut Presentation, data_part: &str, frame: &Xfrm, id: u32) -> Result<String> {
    let doc = pres.xml(data_part)?;
    let model = Model::read(&doc)?;
    let tree = model.tree();
    let mut paras = String::new();
    for (node, depth) in tree.preorder() {
        let Some(p) = model.point(&node) else {
            continue;
        };
        let lvl = depth.saturating_sub(1).min(8);
        let mar = 285_750 + 457_200 * lvl as i64;
        let ppr = format!(
            "<a:pPr marL=\"{mar}\" lvl=\"{lvl}\" indent=\"-285750\"><a:buFont typeface=\"Arial\" panose=\"020B0604020202020204\" pitchFamily=\"34\" charset=\"0\"/><a:buChar char=\"\u{2022}\"/></a:pPr>"
        );
        let ps: Vec<NodeId> = doc
            .child(p.el, Ns::DGM, "t")
            .map(|t| doc.children_named(t, Ns::A, "p").collect())
            .unwrap_or_default();
        if ps.is_empty() {
            paras.push_str(&format!(
                "<a:p>{ppr}<a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p>"
            ));
        }
        for para in ps {
            let runs: String = doc
                .children(para)
                .filter(|&c| doc.local(c) != "pPr" && doc.element(c).is_some())
                .map(|c| String::from_utf8_lossy(&doc.fragment(c).to_bytes()).into_owned())
                .collect();
            paras.push_str(&format!("<a:p>{ppr}{runs}</a:p>"));
        }
    }
    Ok(format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"TextBox {}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap=\"square\" rtlCol=\"0\"><a:normAutofit/></a:bodyPr><a:lstStyle/>{paras}</p:txBody></p:sp>",
        id.saturating_sub(1),
        emu(frame.x),
        emu(frame.y),
        emu(frame.w),
        emu(frame.h),
    ))
}
