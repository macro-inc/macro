//! The SmartArt part of the deck outline: a diagram's layout, colors,
//! style, and node tree, with where each node is drawn.

use super::catalog::{find_colors, find_style, layout_name};
use super::data::{self, CxnKind, Model};
use super::{kind_of, parts_of};
use crate::inspect::ShapeOutline;
use crate::model::color::find_color;
use crate::model::presentation::{Presentation, SlideContext};
use crate::model::shape::{Graphic, Shape, ShapeKind, Xfrm};
use crate::xml::{NodeId, Ns, XmlDoc};
use serde::Serialize;
use std::collections::HashMap;

/// A SmartArt graphic's layout.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtLayoutOutline {
    /// Layout id (`urn:microsoft.com/office/officeart/2005/8/layout/process1`).
    pub id: String,
    /// Display name (`Basic Process`).
    pub name: String,
    /// Whether the engine lays this layout out itself, so nodes can be
    /// added, removed, and moved (text, colors, and styles always change).
    pub supported: bool,
}

/// One node of a SmartArt graphic (one bullet of its text pane).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtNodeOutline {
    /// Node id (a GUID), as the SmartArt edits take it.
    pub id: String,
    /// Text (`\n` between paragraphs, `\u{b}` for line breaks).
    pub text: String,
    /// Outline level: 1 for top-level nodes.
    pub level: u8,
    /// Parent node id (none for top-level nodes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// Child node ids, in order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
    /// An assistant (organization charts).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub assistant: bool,
    /// The box of the shape that shows the node, `[x, y, w, h]` in points
    /// relative to the SmartArt frame's top-left corner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<[f32; 4]>,
    /// The node's font size in that shape (points).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    /// The node's text color in that shape (`#RRGGBB`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
}

/// A SmartArt graphic.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtOutline {
    /// The layout.
    pub layout: SmartArtLayoutOutline,
    /// Color variation id (`urn:microsoft.com/office/officeart/2005/8/colors/accent1_2`).
    pub colors: String,
    /// Its display name, when known (`Colored Fill - Accent 1`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors_name: Option<String>,
    /// SmartArt style id (`urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1`).
    pub style: String,
    /// Its display name, when known (`Simple Fill`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
    /// Nodes in text-pane order.
    pub nodes: Vec<SmartArtNodeOutline>,
}

/// Fills in `smartArt` for the SmartArt frames among `shapes` (and their
/// group members), whose outlines are `outlines` in the same order.
pub(crate) fn complete_outlines(
    pres: &mut Presentation,
    ctx: &SlideContext,
    shapes: &[Shape],
    outlines: &mut [ShapeOutline],
) {
    for (s, o) in shapes.iter().zip(outlines.iter_mut()) {
        match &s.kind {
            ShapeKind::Group(members) => complete_outlines(pres, ctx, members, &mut o.children),
            ShapeKind::Frame(Graphic::Diagram(_)) => {
                o.smart_art = outline(pres, ctx, &s.part.name, s.node);
            }
            _ => {}
        }
    }
}

/// The outline of the SmartArt frame `frame` on `slide_part`.
fn outline(
    pres: &mut Presentation,
    ctx: &SlideContext,
    slide_part: &str,
    frame: NodeId,
) -> Option<SmartArtOutline> {
    let parts = parts_of(pres, slide_part, frame).ok()?;
    let data_doc = pres.xml(&parts.data).ok()?;
    let model = Model::read(&data_doc).ok()?;
    let layout_doc = parts.layout.as_deref().and_then(|p| pres.xml(p).ok());
    let layout_id = layout_doc
        .as_ref()
        .and_then(|d| d.attr(d.root(), "uniqueId").map(str::to_owned))
        .or_else(|| data::doc_attr(&data_doc, &model, "loTypeId"))
        .unwrap_or_default();
    let title = layout_doc.as_ref().and_then(|d| {
        d.child(d.root(), Ns::DGM, "title")
            .and_then(|t| d.attr(t, "val").map(str::to_owned))
    });
    let id_of = |pres: &mut Presentation, part: Option<&str>, attr: &str| {
        part.and_then(|p| pres.xml(p).ok())
            .and_then(|d| d.attr(d.root(), "uniqueId").map(str::to_owned))
            .or_else(|| data::doc_attr(&data_doc, &model, attr))
            .unwrap_or_default()
    };
    let colors = id_of(pres, parts.colors.as_deref(), "csTypeId");
    let style = id_of(pres, parts.style.as_deref(), "qsTypeId");
    let shapes = parts
        .drawing
        .as_deref()
        .and_then(|d| pres.xml(d).ok())
        .map(|d| node_shapes(&d, &model, ctx))
        .unwrap_or_default();
    let tree = model.tree();
    let nodes = tree
        .preorder()
        .into_iter()
        .map(|(id, depth)| {
            let el = model.point(&id).map(|p| p.el);
            let shape = shapes.get(&id);
            SmartArtNodeOutline {
                text: el
                    .map(|e| data::node_text(&data_doc, e))
                    .unwrap_or_default(),
                level: depth.min(usize::from(u8::MAX)) as u8,
                parent: tree
                    .parent(&id)
                    .filter(|p| *p != tree.root)
                    .map(str::to_owned),
                children: tree.kids(&id).to_vec(),
                assistant: tree.kinds.get(&id) == Some(&data::PtKind::Asst),
                frame: shape.map(|s| s.frame),
                font_size: shape.and_then(|s| s.size),
                text_color: shape.and_then(|s| s.color.clone()),
                id,
            }
        })
        .collect();
    Some(SmartArtOutline {
        layout: SmartArtLayoutOutline {
            name: layout_name(&layout_id, title.as_deref()),
            supported: kind_of(&layout_id).is_some(),
            id: layout_id,
        },
        colors_name: find_colors(&colors).map(|c| c.name),
        colors,
        style_name: find_style(&style).map(|s| s.name.to_owned()),
        style,
        nodes,
    })
}

/// Where a node is drawn.
struct NodeShape {
    frame: [f32; 4],
    size: Option<f32>,
    color: Option<String>,
    /// The shape's id is the node's own (engine drawings), which wins.
    direct: bool,
}

/// The drawing shape showing each node: the one whose `modelId` is the
/// node's id, else a presentation point showing that node alone.
fn node_shapes(doc: &XmlDoc, model: &Model, ctx: &SlideContext) -> HashMap<String, NodeShape> {
    let mut out: HashMap<String, NodeShape> = HashMap::new();
    let nodes: std::collections::HashSet<&str> = model
        .points
        .iter()
        .filter(|p| p.kind.is_node())
        .map(|p| p.id.as_str())
        .collect();
    let mut pres_of: HashMap<&str, Vec<&str>> = HashMap::new();
    for c in model.cxns.iter().filter(|c| c.kind == CxnKind::PresOf) {
        pres_of
            .entry(c.dest.as_str())
            .or_default()
            .push(c.src.as_str());
    }
    let colors = ctx.colors();
    for sp in doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| doc.ns(n) == Ns::DSP && doc.local(n) == "sp")
    {
        let Some(mid) = doc.attr(sp, "modelId") else {
            continue;
        };
        let (node, direct) = if nodes.contains(mid) {
            (mid, true)
        } else {
            match pres_of.get(mid).map(Vec::as_slice) {
                Some([one]) if nodes.contains(one) => (*one, false),
                _ => continue,
            }
        };
        if out.get(node).is_some_and(|s| s.direct && !direct) {
            continue;
        }
        let Some(xfrm) = doc
            .child(sp, Ns::DSP, "spPr")
            .and_then(|s| doc.child(s, Ns::A, "xfrm"))
            .map(|x| Xfrm::parse(doc, x))
        else {
            continue;
        };
        let body = doc.child(sp, Ns::DSP, "txBody");
        let size = body.and_then(|b| {
            doc.descendants(b)
                .into_iter()
                .filter(|&n| matches!(doc.local(n), "rPr" | "endParaRPr"))
                .find_map(|n| doc.attr_f64(n, "sz"))
                .map(|v| (v / 100.0) as f32)
        });
        let color = doc
            .child(sp, Ns::DSP, "style")
            .and_then(|s| doc.child(s, Ns::A, "fontRef"))
            .and_then(|f| find_color(doc, f, &colors))
            .map(|c| format!("#{}", c.to_hex()));
        out.insert(
            node.to_owned(),
            NodeShape {
                frame: [xfrm.x, xfrm.y, xfrm.w, xfrm.h],
                size,
                color,
                direct,
            },
        );
    }
    out
}
