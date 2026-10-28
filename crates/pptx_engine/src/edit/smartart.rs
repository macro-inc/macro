//! SmartArt: reading a diagram's nodes, editing them as PowerPoint's text
//! pane does, changing its layout, colors, and style, creating new diagrams,
//! and converting them to shapes or text.
//!
//! A SmartArt graphic is a graphic frame whose `dgm:relIds` name four parts:
//! the data model (the nodes), the layout definition, the style, and the
//! colors; the data model's extension names a fifth, the drawing, which
//! holds the laid-out shapes. PowerPoint lays the diagram out again from the
//! first four when it opens a file; this engine and other readers draw the
//! drawing. So every edit updates the data model, and the drawing is laid
//! out again by the engine's own layouts ([`layout`]) when the layout is one
//! of them and PowerPoint's arrangement was not customized; otherwise text
//! edits, colors, and styles change the existing drawing in place.

mod catalog;
mod colors;
mod convert;
mod data;
mod drawing;
mod fit;
mod insert;
mod layout;
mod layout_def;
mod outline;
mod preview;
mod quick_style;
mod recolor;

pub(crate) use convert::convert;
pub(crate) use insert::{NewSmartArt, create};
pub(crate) use outline::complete_outlines;
pub use outline::{SmartArtLayoutOutline, SmartArtNodeOutline, SmartArtOutline};
pub use preview::{
    Catalog, CatalogItem, CatalogLayout, PreviewPath, PreviewSpec, catalog, preview,
};

use super::ops::{SmartArtEdit, SmartArtPosition};
use super::xmlutil::find_shape;
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::units::emu_to_pt;
use crate::xml::{NodeId, Ns, XmlDoc};
use catalog::{Kind, LAYOUT_PREFIX};
use colors::ColorsDef;
use data::{IdGen, Model, NewNodes};
use quick_style::StyleDef;

/// Relationship types of the diagram parts.
pub(crate) mod rels {
    /// Slide → data model.
    pub const DATA: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData";
    /// Slide → layout definition.
    pub const LAYOUT: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout";
    /// Slide → style.
    pub const STYLE: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle";
    /// Slide → colors.
    pub const COLORS: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors";
}

/// Content types of the diagram parts.
pub(crate) mod content_types {
    /// Data model.
    pub const DATA: &str =
        "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml";
    /// Layout definition.
    pub const LAYOUT: &str =
        "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml";
    /// Style.
    pub const STYLE: &str =
        "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml";
    /// Colors.
    pub const COLORS: &str =
        "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml";
    /// Drawing.
    pub const DRAWING: &str = "application/vnd.ms-office.drawingml.diagramDrawing+xml";
}

/// The message for structural edits on layouts the engine cannot lay out.
const UNSUPPORTED: &str = "this layout's structure can't be changed here";

/// Whether a graphic frame holds SmartArt.
pub(crate) fn is_smart_art(doc: &XmlDoc, frame: NodeId) -> bool {
    doc.path(frame, Ns::A, &["graphic", "graphicData"])
        .and_then(|g| doc.attr(g, "uri"))
        .is_some_and(|u| u.ends_with("/diagram"))
}

/// The parts of one SmartArt graphic.
#[derive(Clone, Debug)]
pub(crate) struct Parts {
    /// Data model part.
    pub data: String,
    /// Layout definition part.
    pub layout: Option<String>,
    /// Style part.
    pub style: Option<String>,
    /// Colors part.
    pub colors: Option<String>,
    /// Drawing part.
    pub drawing: Option<String>,
}

/// Finds the parts of the SmartArt frame `frame` on `slide_part`.
pub(crate) fn parts_of(pres: &mut Presentation, slide_part: &str, frame: NodeId) -> Result<Parts> {
    let slide = pres.part(slide_part)?;
    let doc = &slide.doc;
    let rel_ids = doc
        .path(frame, Ns::A, &["graphic", "graphicData"])
        .and_then(|g| doc.child(g, Ns::DGM, "relIds"))
        .ok_or_else(|| Error::InvalidEdit("the shape is not SmartArt".into()))?;
    let target = |attr: &str| {
        doc.attr_ns(rel_ids, Ns::R, attr)
            .and_then(|id| slide.target(id))
    };
    let data = target("dm").ok_or_else(|| Error::MissingPart("SmartArt data".into()))?;
    let (layout, style, colors) = (target("lo"), target("qs"), target("cs"));
    let drawing = drawing_part(pres, slide_part, &data)?;
    Ok(Parts {
        data,
        layout,
        style,
        colors,
        drawing,
    })
}

/// The drawing part of a data part: the slide relationship its
/// `dsp:dataModelExt` names, else a drawing numbered like it.
fn drawing_part(pres: &mut Presentation, slide_part: &str, data: &str) -> Result<Option<String>> {
    let doc = pres.xml(data)?;
    let slide = pres.part(slide_part)?;
    let rel_id = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.local(n) == "dataModelExt")
        .and_then(|n| doc.attr(n, "relId").map(str::to_owned));
    if let Some(t) = rel_id.and_then(|id| slide.target(&id))
        && pres.package().has_part(&t)
    {
        return Ok(Some(t));
    }
    let digits: String = data.chars().filter(char::is_ascii_digit).collect();
    Ok(slide
        .rels
        .iter()
        .filter(|r| r.rel_type == rel_type::DIAGRAM_DRAWING)
        .map(|r| slide.rels.resolve(r))
        .find(|d| d.chars().filter(char::is_ascii_digit).collect::<String>() == digits))
}

/// The `uniqueId` of a definition part.
fn unique_id(pres: &mut Presentation, part: Option<&str>) -> Option<String> {
    let doc = pres.xml(part?).ok()?;
    doc.attr(doc.root(), "uniqueId").map(str::to_owned)
}

/// The layout id of a diagram: its layout part's, else the data model's.
fn layout_id(pres: &mut Presentation, parts: &Parts) -> Result<String> {
    if let Some(id) = unique_id(pres, parts.layout.as_deref()) {
        return Ok(id);
    }
    let doc = pres.xml(&parts.data)?;
    let model = Model::read(&doc)?;
    Ok(data::doc_attr(&doc, &model, "loTypeId").unwrap_or_default())
}

/// The engine's layout for a layout id, if it has one.
fn kind_of(layout: &str) -> Option<Kind> {
    let short = layout.rsplit('/').next()?;
    if !layout.is_empty() && !layout.starts_with(LAYOUT_PREFIX) && layout.contains('/') {
        return None;
    }
    catalog::LAYOUTS
        .iter()
        .find(|l| l.short == short)
        .and_then(|l| l.kind)
}

/// The frame element and size (points) of a SmartArt shape.
fn frame_of(pres: &mut Presentation, slide_part: &str, shape: u32) -> Result<(NodeId, f32, f32)> {
    let doc = pres.xml(slide_part)?;
    let node = find_shape(&doc, shape).ok_or_else(|| Error::NotFound(format!("shape {shape}")))?;
    if doc.local(node) != "graphicFrame" || !is_smart_art(&doc, node) {
        return Err(Error::InvalidEdit(format!("shape {shape} is not SmartArt")));
    }
    let ext = doc
        .child(node, Ns::P, "xfrm")
        .and_then(|x| doc.child(x, Ns::A, "ext"));
    let size = |a: &str| ext.and_then(|e| doc.attr_f64(e, a)).map_or(0.0, emu_to_pt);
    Ok((node, size("cx"), size("cy")))
}

/// Whether the engine can lay a diagram out again (its layout is one of the
/// engine's and PowerPoint's arrangement was not customized).
fn relayoutable(pres: &mut Presentation, parts: &Parts) -> Result<Option<Kind>> {
    let Some(kind) = kind_of(&layout_id(pres, parts)?) else {
        return Ok(None);
    };
    let doc = pres.xml(&parts.data)?;
    let model = Model::read(&doc)?;
    Ok((!model.customized(&doc)).then_some(kind))
}

/// The colors and style definitions of a diagram (built-in ones when its
/// parts are missing).
fn definitions(pres: &mut Presentation, parts: &Parts) -> Result<(ColorsDef, StyleDef)> {
    let colors = match parts.colors.as_deref() {
        Some(p) => ColorsDef::parse(&*pres.xml(p)?),
        None => {
            let xml = colors::builtin_xml(catalog::DEFAULT_COLORS).map(|(_, x)| x);
            xml.and_then(|x| XmlDoc::parse(x.as_bytes(), "colors").ok())
                .map(|d| ColorsDef::parse(&d))
                .unwrap_or_default()
        }
    };
    let style = match parts.style.as_deref() {
        Some(p) => StyleDef::parse(&*pres.xml(p)?),
        None => StyleDef::default(),
    };
    Ok((colors, style))
}

/// Lays the SmartArt frame `shape` out again and rewrites its drawing,
/// when the engine can (see [`relayoutable`]).
pub(crate) fn refresh(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    fonts: &FontDb,
) -> Result<()> {
    let (frame, w, h) = frame_of(pres, slide_part, shape)?;
    let parts = parts_of(pres, slide_part, frame)?;
    let Some(kind) = relayoutable(pres, &parts)? else {
        return Ok(());
    };
    let (colors, style) = definitions(pres, &parts)?;
    let data_doc = pres.xml(&parts.data)?;
    let model = Model::read(&data_doc)?;
    let d = drawing::diagram_of(&model);
    let src = drawing::Source::new(&data_doc, &model, &d);
    let slide = pres.part(slide_part)?;
    let ctx = pres.context_for(slide, 1)?;
    let laid = {
        let mut m = fit::Measurer::new(&ctx, fonts, &src, &d);
        layout::lay_out(kind, &d, w, h, &mut m)
    };
    let paint = drawing::Paint {
        ctx: &ctx,
        colors: &colors,
        style: &style,
    };
    let doc = drawing::write(&laid, &d, &src, &paint, &format!("{}#drawing", parts.data))?;
    match parts.drawing {
        Some(name) => {
            let current = pres.xml(&name)?;
            if current.to_bytes() != doc.to_bytes() {
                *pres.xml_mut(&name)? = doc;
            }
        }
        None => insert::add_drawing(pres, slide_part, &parts.data, doc)?,
    }
    Ok(())
}

/// Applies one SmartArt edit to the frame `shape` (the drawing is laid out
/// again by [`refresh`] at the end of the batch).
pub(crate) fn edit(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    edit: &SmartArtEdit,
) -> Result<()> {
    let (frame, _, _) = frame_of(pres, slide_part, shape)?;
    let parts = parts_of(pres, slide_part, frame)?;
    let ids = pres.pkg.ids().cloned();
    match edit {
        SmartArtEdit::SetText { node, text } => {
            let relayout = relayoutable(pres, &parts)?.is_some();
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            let pt = model
                .point(node)
                .filter(|p| p.kind.is_node())
                .ok_or_else(|| Error::NotFound(format!("SmartArt node {node}")))?
                .el;
            let body = data::ensure_text(doc, pt)?;
            let old_count = doc.children_named(body, Ns::A, "p").count();
            super::text::set_text(doc, body, text)?;
            if !relayout && let Some(drawing) = parts.drawing.as_deref() {
                recolor::update_text(pres, &parts.data, drawing, node, old_count)?;
            }
        }
        SmartArtEdit::SetLayout { layout } => {
            let info = catalog::find_layout(layout)
                .filter(|l| l.kind.is_some())
                .ok_or_else(|| {
                    Error::InvalidEdit(format!("unknown or unsupported SmartArt layout `{layout}`"))
                })?;
            let xml = layout_def::xml(info);
            let name = insert::write_part(
                pres,
                "/ppt/diagrams/layout",
                xml.into_bytes(),
                content_types::LAYOUT,
            );
            repoint(pres, slide_part, frame, "lo", rels::LAYOUT, &name)?;
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            data::set_doc_attrs(
                doc,
                &model,
                &[("loTypeId", &info.id()), ("loCatId", info.categories[0])],
            )?;
            data::drop_presentation(doc, &model);
        }
        SmartArtEdit::SetColors { colors } => {
            let (info, xml) = colors::builtin_xml(colors)
                .ok_or_else(|| Error::InvalidEdit(format!("unknown SmartArt colors `{colors}`")))?;
            let name = insert::write_part(
                pres,
                "/ppt/diagrams/colors",
                xml.into_bytes(),
                content_types::COLORS,
            );
            repoint(pres, slide_part, frame, "cs", rels::COLORS, &name)?;
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            data::set_doc_attrs(
                doc,
                &model,
                &[("csTypeId", &info.id()), ("csCatId", &info.category)],
            )?;
            repaint_unless_relayout(pres, slide_part, frame)?;
        }
        SmartArtEdit::SetStyle { style } => {
            let (info, xml) = quick_style::builtin_xml(style)
                .ok_or_else(|| Error::InvalidEdit(format!("unknown SmartArt style `{style}`")))?;
            let name = insert::write_part(
                pres,
                "/ppt/diagrams/quickStyle",
                xml.into_bytes(),
                content_types::STYLE,
            );
            repoint(pres, slide_part, frame, "qs", rels::STYLE, &name)?;
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            data::set_doc_attrs(
                doc,
                &model,
                &[("qsTypeId", &info.id()), ("qsCatId", "simple")],
            )?;
            repaint_unless_relayout(pres, slide_part, frame)?;
        }
        SmartArtEdit::Reset => {
            if kind_of(&layout_id(pres, &parts)?).is_none() {
                return Err(Error::InvalidEdit(UNSUPPORTED.into()));
            }
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            for p in model.points.iter().filter(|p| p.kind.is_node()) {
                if let Some(sp) = doc.child(p.el, Ns::DGM, "spPr") {
                    for c in doc.child_nodes(sp).to_vec() {
                        doc.detach(c);
                    }
                }
            }
            data::drop_presentation(doc, &model);
        }
        structural => {
            if kind_of(&layout_id(pres, &parts)?).is_none() {
                return Err(Error::InvalidEdit(UNSUPPORTED.into()));
            }
            let doc = pres.xml_mut(&parts.data)?;
            let model = Model::read(doc)?;
            let mut tree = model.tree();
            let mut idgen = IdGen::new(ids.as_deref(), &parts.data, doc);
            let mut new = NewNodes::new();
            match structural {
                SmartArtEdit::AddNode {
                    node,
                    position,
                    text,
                } => {
                    let id = idgen.next();
                    match node.as_deref() {
                        None => tree.add_last(&id),
                        Some(n) => match position {
                            SmartArtPosition::After => tree.add_after(n, &id)?,
                            SmartArtPosition::Before => tree.add_before(n, &id)?,
                            SmartArtPosition::Above => tree.add_above(n, &id)?,
                            SmartArtPosition::Below => tree.add_below(n, &id)?,
                            SmartArtPosition::Assistant => tree.add_assistant(n, &id)?,
                        },
                    }
                    new.insert(id, (!text.is_empty()).then(|| text.clone()));
                }
                SmartArtEdit::DeleteNode { node } => tree.delete(node)?,
                SmartArtEdit::Promote { node } => tree.promote(node)?,
                SmartArtEdit::Demote { node } => tree.demote(node)?,
                SmartArtEdit::MoveUp { node } => tree.move_by(node, true)?,
                SmartArtEdit::MoveDown { node } => tree.move_by(node, false)?,
                SmartArtEdit::SetNodes { items } => {
                    let texts = insert::outline_tree(&mut tree, items, &mut idgen, &mut new)?;
                    data::write_tree(doc, &tree, &new, &mut idgen)?;
                    let model = Model::read(doc)?;
                    for (id, text) in texts {
                        if new.contains_key(&id) {
                            continue;
                        }
                        if let Some(p) = model.point(&id) {
                            let el = p.el;
                            let body = data::ensure_text(doc, el)?;
                            super::text::set_text(doc, body, &text)?;
                        }
                    }
                    return Ok(());
                }
                _ => unreachable!("handled above"),
            }
            data::write_tree(doc, &tree, &new, &mut idgen)?;
        }
    }
    Ok(())
}

/// Recolors an existing drawing in place when the engine will not lay it
/// out again (other layouts, or customized arrangements).
fn repaint_unless_relayout(pres: &mut Presentation, slide_part: &str, frame: NodeId) -> Result<()> {
    let parts = parts_of(pres, slide_part, frame)?;
    if relayoutable(pres, &parts)?.is_some() {
        return Ok(());
    }
    recolor::repaint(pres, slide_part, &parts)
}

/// Points the frame's `r:{attr}` relationship at `target`.
fn repoint(
    pres: &mut Presentation,
    slide_part: &str,
    frame: NodeId,
    attr: &str,
    rel: &str,
    target: &str,
) -> Result<()> {
    let rid = pres.rels_mut(slide_part)?.add_internal(rel, target);
    let doc = pres.xml_mut(slide_part)?;
    let rel_ids = doc
        .path(frame, Ns::A, &["graphic", "graphicData"])
        .and_then(|g| doc.child(g, Ns::DGM, "relIds"))
        .ok_or_else(|| Error::InvalidEdit("the shape is not SmartArt".into()))?;
    doc.set_attr_ns(rel_ids, Ns::R, attr, &rid);
    Ok(())
}

#[cfg(test)]
mod test;
