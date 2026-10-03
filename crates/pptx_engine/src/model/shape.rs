//! The shape tree: transforms, placeholders, geometry, and graphic frames.

use super::color::{ColorContext, Rgba, find_color};
use super::fill::{Effects, Fill, ImageFill, LineProps, find_fill, parse_blip_fill, parse_effects, parse_line};
use super::presentation::{PartRef, SlideContext};
use super::text::{TextBody, resolve_text_body};
use crate::path::{Affine, Rect};
use crate::units::emu_to_pt;
use crate::xml::{Ns, NodeId, XmlDoc};

/// A shape's position, size, rotation, and flips (points, parent coordinates).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Xfrm {
    /// Left.
    pub x: f32,
    /// Top.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// Clockwise rotation in degrees.
    pub rot: f32,
    /// Mirrored horizontally.
    pub flip_h: bool,
    /// Mirrored vertically.
    pub flip_v: bool,
    /// Child coordinate space of a group (`chOff`/`chExt`).
    pub child: Option<Rect>,
}

impl Xfrm {
    /// Reads an `a:xfrm`/`p:xfrm` element.
    pub fn parse(doc: &XmlDoc, node: NodeId) -> Self {
        let pt = |n: Option<NodeId>, a: &str| n.and_then(|n| doc.attr_f64(n, a)).map_or(0.0, emu_to_pt);
        let off = doc.child(node, Ns::A, "off");
        let ext = doc.child(node, Ns::A, "ext");
        let ch_off = doc.child(node, Ns::A, "chOff");
        let ch_ext = doc.child(node, Ns::A, "chExt");
        Self {
            x: pt(off, "x"),
            y: pt(off, "y"),
            w: pt(ext, "cx").max(0.0),
            h: pt(ext, "cy").max(0.0),
            rot: doc.attr_f64(node, "rot").map_or(0.0, |r| (r / 60000.0) as f32),
            flip_h: doc.attr_bool(node, "flipH").unwrap_or(false),
            flip_v: doc.attr_bool(node, "flipV").unwrap_or(false),
            child: (ch_off.is_some() || ch_ext.is_some())
                .then(|| Rect::from_xywh(pt(ch_off, "x"), pt(ch_off, "y"), pt(ch_ext, "cx"), pt(ch_ext, "cy"))),
        }
    }

    /// The box in parent coordinates (before rotation).
    pub fn rect(&self) -> Rect {
        Rect::from_xywh(self.x, self.y, self.w, self.h)
    }

    /// Shape-local (`0..w`, `0..h`) → parent coordinates, including rotation and flips.
    pub fn local_to_parent(&self) -> Affine {
        let (cx, cy) = (f64::from(self.x + self.w / 2.0), f64::from(self.y + self.h / 2.0));
        let flip = Affine::scale(if self.flip_h { -1.0 } else { 1.0 }, if self.flip_v { -1.0 } else { 1.0 });
        Affine::translate(cx, cy)
            .pre_concat(&Affine::rotate(f64::from(self.rot)))
            .pre_concat(&flip)
            .pre_concat(&Affine::translate(-f64::from(self.w / 2.0), -f64::from(self.h / 2.0)))
    }

    /// Like [`Self::local_to_parent`] but text is never mirrored: a horizontal
    /// flip is ignored and a vertical flip turns text upside down, as PowerPoint does.
    pub fn text_to_parent(&self) -> Affine {
        let (cx, cy) = (f64::from(self.x + self.w / 2.0), f64::from(self.y + self.h / 2.0));
        let extra = if self.flip_v { 180.0 } else { 0.0 };
        Affine::translate(cx, cy)
            .pre_concat(&Affine::rotate(f64::from(self.rot) + extra))
            .pre_concat(&Affine::translate(-f64::from(self.w / 2.0), -f64::from(self.h / 2.0)))
    }

    /// Group child coordinates → group-local coordinates.
    pub fn child_to_local(&self) -> Affine {
        match self.child {
            Some(ch) if ch.w > 0.0 && ch.h > 0.0 => Affine::scale(f64::from(self.w / ch.w), f64::from(self.h / ch.h))
                .pre_concat(&Affine::translate(-f64::from(ch.x), -f64::from(ch.y))),
            Some(ch) => Affine::translate(-f64::from(ch.x), -f64::from(ch.y)),
            None => Affine::translate(-f64::from(self.x), -f64::from(self.y)),
        }
    }
}

/// Placeholder identity (`p:ph`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placeholder {
    /// Placeholder type (`title`, `body`, `ctrTitle`, `subTitle`, `dt`, `ftr`, `sldNum`, `pic`, `obj`...).
    pub kind: String,
    /// Index used to match layout placeholders.
    pub idx: u32,
}

impl Placeholder {
    /// The master text style family (`title`, `body`, or `other`).
    pub fn style_family(&self) -> &'static str {
        match self.kind.as_str() {
            "title" | "ctrTitle" => "title",
            "dt" | "ftr" | "sldNum" | "hdr" => "other",
            _ => "body",
        }
    }

    /// The master placeholder type this one inherits from.
    pub fn master_kind(&self) -> &str {
        match self.kind.as_str() {
            "ctrTitle" | "title" => "title",
            "dt" | "ftr" | "sldNum" | "hdr" => &self.kind,
            _ => "body",
        }
    }
}

/// Reads the placeholder of a shape element, if it is one.
pub fn placeholder_of(doc: &XmlDoc, shape: NodeId) -> Option<Placeholder> {
    let nv = doc.children(shape).find(|&c| doc.local(c).starts_with("nv"))?;
    let nvpr = doc.child(nv, Ns::P, "nvPr")?;
    let ph = doc.child(nvpr, Ns::P, "ph")?;
    Some(Placeholder {
        kind: doc.attr(ph, "type").unwrap_or("obj").to_owned(),
        idx: doc.attr_i64(ph, "idx").unwrap_or(0).max(0) as u32,
    })
}

/// The `cNvPr` element of a shape.
pub fn c_nv_pr(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    let nv = doc.children(shape).find(|&c| doc.local(c).starts_with("nv"))?;
    doc.children(nv).find(|&c| doc.local(c) == "cNvPr")
}

/// What a graphic frame contains.
#[derive(Clone, Debug)]
pub enum Graphic {
    /// A table (`a:tbl` element in the shape's part).
    Table(NodeId),
    /// A chart part.
    Chart(String),
    /// SmartArt: the diagram data part (its pre-laid-out drawing is looked up at render time).
    Diagram(Option<String>),
    /// An embedded object rendered through its preview picture.
    Ole {
        /// Preview picture from a `p:pic` child, when present.
        preview: Option<ImageFill>,
        /// VML shape id used by older files to locate the preview image.
        spid: Option<String>,
    },
    /// Unsupported content.
    Unknown,
}

/// What kind of shape this is.
#[derive(Clone, Debug)]
pub enum ShapeKind {
    /// `p:sp`.
    Shape,
    /// `p:cxnSp`.
    Connector,
    /// `p:pic`.
    Picture(Option<ImageFill>),
    /// `p:graphicFrame`.
    Frame(Graphic),
    /// `p:grpSp`.
    Group(Vec<Shape>),
}

/// The geometry reference of a shape.
#[derive(Clone, Debug)]
pub enum GeometryRef {
    /// A preset with adjust values.
    Preset(String, Vec<crate::geometry::Adjust>),
    /// A `custGeom` element in `part`.
    Custom(PartRef, NodeId),
}

/// A shape with all inherited properties resolved.
#[derive(Clone, Debug)]
pub struct Shape {
    /// Part containing the shape element.
    pub part: PartRef,
    /// The shape element.
    pub node: NodeId,
    /// `cNvPr/@id`.
    pub id: u32,
    /// `cNvPr/@name`.
    pub name: String,
    /// Alt text.
    pub descr: String,
    /// Hidden shapes are not rendered.
    pub hidden: bool,
    /// Placeholder identity.
    pub placeholder: Option<Placeholder>,
    /// Kind and kind-specific content.
    pub kind: ShapeKind,
    /// Position in parent coordinates.
    pub xfrm: Xfrm,
    /// Geometry.
    pub geometry: GeometryRef,
    /// Fill (already resolved through placeholders and the style matrix).
    pub fill: Fill,
    /// Outline.
    pub line: LineProps,
    /// Effects.
    pub effects: Effects,
    /// Text, if any.
    pub text: Option<TextBody>,
}

/// Context passed while walking a shape tree.
pub struct WalkCtx<'a> {
    /// The slide context.
    pub ctx: &'a SlideContext,
    /// Whether this tree belongs to the slide itself (placeholders inherit) or a layout/master.
    pub inherit: Inherit,
}

/// Which inheritance chain applies to placeholders in a tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Inherit {
    /// Slide shapes: slide → layout → master.
    Slide,
    /// Layout shapes: layout → master.
    Layout,
    /// Master shapes: no placeholder inheritance.
    Master,
}

impl SlideContext {
    /// A color context for this slide.
    pub fn colors(&self) -> ColorContext<'_> {
        ColorContext { scheme: &self.theme.colors, map: &self.color_map, ph_clr: None }
    }
}

/// Picks the branch of an `mc:AlternateContent` the engine understands.
pub fn alternate_content_choice(doc: &XmlDoc, ac: NodeId) -> Option<NodeId> {
    const SUPPORTED: &[&str] = &["p14", "a14", "p15", "a15", "a16", "p16", "a1611", "p159", "asvg"];
    for c in doc.children(ac) {
        match doc.local(c) {
            "Choice" => {
                let requires = doc.attr(c, "Requires").unwrap_or("");
                let ok = requires.split_whitespace().all(|r| SUPPORTED.contains(&r));
                let has_math = doc.descendants(c).iter().any(|&n| doc.ns(n) == Ns::A14 && doc.local(n) == "m");
                if ok && !has_math {
                    return Some(c);
                }
            }
            "Fallback" => return Some(c),
            _ => {}
        }
    }
    None
}

/// Child elements of a shape tree, with alternate content resolved.
pub fn tree_children(doc: &XmlDoc, tree: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    for c in doc.children(tree) {
        if doc.ns(c) == Ns::MC && doc.local(c) == "AlternateContent" {
            if let Some(branch) = alternate_content_choice(doc, c) {
                out.extend(doc.children(branch));
            }
        } else {
            out.push(c);
        }
    }
    out
}

const SHAPE_ELEMENTS: [&str; 5] = ["sp", "grpSp", "pic", "graphicFrame", "cxnSp"];

/// Whether `node` is a shape element.
pub fn is_shape_element(doc: &XmlDoc, node: NodeId) -> bool {
    matches!(doc.ns(node), Ns::P | Ns::DSP) && SHAPE_ELEMENTS.contains(&doc.local(node))
}

/// Finds the placeholder in `tree` matching `ph` (by index, then by type).
pub fn find_placeholder(doc: &XmlDoc, tree: NodeId, ph: &Placeholder, master: bool) -> Option<NodeId> {
    let mut all = Vec::new();
    collect_placeholders(doc, tree, &mut all);
    if master {
        let kind = ph.master_kind();
        return all
            .iter()
            .find(|(_, p)| p.kind == kind || (kind == "title" && p.kind == "ctrTitle"))
            .or_else(|| all.iter().find(|(_, p)| p.master_kind() == kind))
            .map(|(n, _)| *n);
    }
    let same_family = |a: &Placeholder, b: &Placeholder| {
        a.kind == b.kind || a.master_kind() == b.master_kind() && a.style_family() != "other"
    };
    if ph.idx != 0 {
        if let Some((n, _)) = all.iter().find(|(_, p)| p.idx == ph.idx) {
            return Some(*n);
        }
    }
    all.iter()
        .find(|(_, p)| p.kind == ph.kind)
        .or_else(|| {
            if matches!(ph.kind.as_str(), "title" | "ctrTitle") {
                all.iter().find(|(_, p)| matches!(p.kind.as_str(), "title" | "ctrTitle"))
            } else {
                None
            }
        })
        .or_else(|| if ph.idx == 0 { None } else { all.iter().find(|(_, p)| same_family(p, ph) && p.kind == "obj") })
        .map(|(n, _)| *n)
}

fn collect_placeholders(doc: &XmlDoc, tree: NodeId, out: &mut Vec<(NodeId, Placeholder)>) {
    for c in tree_children(doc, tree) {
        if let Some(p) = placeholder_of(doc, c) {
            out.push((c, p));
        } else if doc.local(c) == "grpSp" {
            collect_placeholders(doc, c, out);
        }
    }
}

/// The `p:cSld/p:spTree` element of a slide-like part.
pub fn sp_tree(doc: &XmlDoc) -> Option<NodeId> {
    doc.path(doc.root(), Ns::P, &["cSld", "spTree"])
}

/// The inheritance chain of a shape: itself, then matching layout and master placeholders.
pub fn placeholder_chain(ctx: &SlideContext, part: &PartRef, node: NodeId, inherit: Inherit) -> Vec<(PartRef, NodeId)> {
    let mut chain = vec![(part.clone(), node)];
    let Some(ph) = placeholder_of(&part.doc, node) else { return chain };
    if inherit == Inherit::Slide {
        if let Some(layout) = &ctx.layout {
            if let Some(n) = sp_tree(&layout.doc).and_then(|t| find_placeholder(&layout.doc, t, &ph, false)) {
                chain.push((layout.clone(), n));
            }
        }
    }
    if inherit != Inherit::Master {
        if let Some(master) = &ctx.master {
            // Inherit through the layout's placeholder type when it was found there.
            let key = chain
                .last()
                .and_then(|(p, n)| placeholder_of(&p.doc, *n))
                .unwrap_or(ph);
            if let Some(n) = sp_tree(&master.doc).and_then(|t| find_placeholder(&master.doc, t, &key, true)) {
                chain.push((master.clone(), n));
            }
        }
    }
    chain
}

fn sp_pr(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape).find(|&c| doc.local(c) == "spPr" || doc.local(c) == "grpSpPr")
}

/// Resolves every shape in a tree.
pub fn resolve_tree(w: &WalkCtx<'_>, part: &PartRef, tree: NodeId) -> Vec<Shape> {
    tree_children(&part.doc, tree)
        .into_iter()
        .filter(|&c| is_shape_element(&part.doc, c))
        .filter_map(|c| resolve_shape(w, part, c))
        .collect()
}

/// Resolves one shape element.
pub fn resolve_shape(w: &WalkCtx<'_>, part: &PartRef, node: NodeId) -> Option<Shape> {
    let doc = &part.doc;
    let ctx = w.ctx;
    let nvpr = c_nv_pr(doc, node);
    let id = nvpr.and_then(|n| doc.attr_i64(n, "id")).unwrap_or(0).max(0) as u32;
    let name = nvpr.and_then(|n| doc.attr(n, "name")).unwrap_or("").to_owned();
    let descr = nvpr.and_then(|n| doc.attr(n, "descr")).unwrap_or("").to_owned();
    let hidden = nvpr.and_then(|n| doc.attr_bool(n, "hidden")).unwrap_or(false);
    let placeholder = placeholder_of(doc, node);
    let chain = placeholder_chain(ctx, part, node, w.inherit);
    let colors = ctx.colors();

    let xfrm = chain
        .iter()
        .find_map(|(p, n)| {
            let x = if p.doc.local(*n) == "graphicFrame" {
                p.doc.child(*n, Ns::P, "xfrm")
            } else {
                sp_pr(&p.doc, *n).and_then(|s| p.doc.child(s, Ns::A, "xfrm"))
            };
            x.map(|x| Xfrm::parse(&p.doc, x))
        })
        .unwrap_or_default();

    let geometry = chain
        .iter()
        .find_map(|(p, n)| {
            let s = sp_pr(&p.doc, *n)?;
            if let Some(g) = p.doc.child(s, Ns::A, "prstGeom") {
                let prst = p.doc.attr(g, "prst").unwrap_or("rect").to_owned();
                return Some(GeometryRef::Preset(prst, crate::geometry::adjust_values(&p.doc, g)));
            }
            p.doc.child(s, Ns::A, "custGeom").map(|g| GeometryRef::Custom(p.clone(), g))
        })
        .unwrap_or_else(|| GeometryRef::Preset("rect".into(), Vec::new()));

    let style = doc.children(node).find(|&c| doc.local(c) == "style");
    let style_ref = |name: &str| -> Option<(u32, Option<Rgba>)> {
        let r = doc.child(style?, Ns::A, name)?;
        let idx = doc.attr_i64(r, "idx").unwrap_or(0).max(0) as u32;
        Some((idx, find_color(doc, r, &colors)))
    };
    let rels_of = |p: &PartRef| {
        let rels = p.rels.clone();
        move |id: &str| rels.target_part(id)
    };

    // Fill: explicit spPr fill anywhere in the chain, else the style matrix.
    let explicit_fill = chain.iter().find_map(|(p, n)| {
        let s = sp_pr(&p.doc, *n)?;
        let resolver = rels_of(p);
        find_fill(&p.doc, s, &colors, &resolver)
    });
    let fill = explicit_fill.unwrap_or_else(|| {
        style_ref("fillRef")
            .and_then(|(idx, color)| {
                let theme = &ctx.theme;
                let node = theme.fill_style(idx)?;
                let tctx = colors.with_ph(color);
                Some(super::fill::parse_fill(&theme.doc, node, &tctx, &|_| None))
            })
            .unwrap_or(Fill::None)
    });

    let mut line = LineProps::default();
    for (p, n) in &chain {
        if let Some(ln) = sp_pr(&p.doc, *n).and_then(|s| p.doc.child(s, Ns::A, "ln")) {
            let resolver = rels_of(p);
            line.inherit(&parse_line(&p.doc, ln, &colors, &resolver));
        }
    }
    if let Some((idx, color)) = style_ref("lnRef") {
        if let Some(ln) = ctx.theme.line_style(idx) {
            let tctx = colors.with_ph(color);
            line.inherit(&parse_line(&ctx.theme.doc, ln, &tctx, &|_| None));
        }
    }

    let effects = chain
        .iter()
        .find_map(|(p, n)| {
            let s = sp_pr(&p.doc, *n)?;
            p.doc.child(s, Ns::A, "effectLst").map(|e| parse_effects(&p.doc, e, &colors))
        })
        .or_else(|| {
            let (idx, color) = style_ref("effectRef")?;
            let es = ctx.theme.effect_style(idx)?;
            let el = ctx.theme.doc.child(es, Ns::A, "effectLst")?;
            Some(parse_effects(&ctx.theme.doc, el, &colors.with_ph(color)))
        })
        .unwrap_or_default();

    let kind = match doc.local(node) {
        "grpSp" => {
            let children = resolve_tree(w, part, node);
            ShapeKind::Group(children)
        }
        "pic" => {
            let resolver = rels_of(part);
            let bf = doc.children(node).find(|&c| doc.local(c) == "blipFill");
            ShapeKind::Picture(bf.and_then(|b| parse_blip_fill(doc, b, &colors, &resolver)))
        }
        "graphicFrame" => ShapeKind::Frame(graphic_of(ctx, part, node)),
        "cxnSp" => ShapeKind::Connector,
        _ => ShapeKind::Shape,
    };

    let text = if matches!(kind, ShapeKind::Shape | ShapeKind::Connector) {
        let font_ref = style.and_then(|s| doc.child(s, Ns::A, "fontRef"));
        resolve_text_body(ctx, &chain, placeholder.as_ref(), font_ref.map(|f| (&**doc, f)), w.inherit)
    } else {
        None
    };

    Some(Shape { part: part.clone(), node, id, name, descr, hidden, placeholder, kind, xfrm, geometry, fill, line, effects, text })
}

fn graphic_of(ctx: &SlideContext, part: &PartRef, node: NodeId) -> Graphic {
    let doc = &part.doc;
    let Some(data) = doc.path(node, Ns::A, &["graphic", "graphicData"]) else { return Graphic::Unknown };
    let uri = doc.attr(data, "uri").unwrap_or("");
    if uri.ends_with("/table") {
        return doc.child(data, Ns::A, "tbl").map_or(Graphic::Unknown, Graphic::Table);
    }
    if uri.ends_with("/chart") {
        return doc
            .child(data, Ns::C, "chart")
            .and_then(|c| doc.attr_ns(c, Ns::R, "id"))
            .and_then(|id| part.target(id))
            .map_or(Graphic::Unknown, Graphic::Chart);
    }
    if uri.ends_with("/diagram") {
        let data_part = doc
            .child(data, Ns::DGM, "relIds")
            .and_then(|r| doc.attr_ns(r, Ns::R, "dm"))
            .and_then(|id| part.target(id));
        return Graphic::Diagram(data_part);
    }
    if uri.ends_with("/ole") {
        return ole_graphic(ctx, part, data);
    }
    // Other content (chartex, slicers...) usually carries an AlternateContent fallback.
    if let Some(ac) = doc.children(data).find(|&c| doc.local(c) == "AlternateContent") {
        if let Some(branch) = alternate_content_choice(doc, ac) {
            if let Some(ole) = doc.children(branch).find(|&c| doc.local(c) == "oleObj") {
                return Graphic::Ole {
                    preview: ole_image(ctx, part, ole),
                    spid: doc.attr(ole, "spid").map(str::to_owned),
                };
            }
        }
    }
    Graphic::Unknown
}

fn ole_graphic(ctx: &SlideContext, part: &PartRef, data: NodeId) -> Graphic {
    let doc = &part.doc;
    let ole = doc.children(data).find_map(|c| {
        if doc.local(c) == "oleObj" {
            Some(c)
        } else if doc.local(c) == "AlternateContent" {
            let branch = alternate_content_choice(doc, c)?;
            doc.children(branch).find(|&o| doc.local(o) == "oleObj")
        } else {
            None
        }
    });
    match ole {
        Some(ole) => Graphic::Ole {
            preview: ole_image(ctx, part, ole),
            spid: doc.attr(ole, "spid").map(str::to_owned),
        },
        None => Graphic::Unknown,
    }
}

fn ole_image(ctx: &SlideContext, part: &PartRef, ole: NodeId) -> Option<ImageFill> {
    let doc = &part.doc;
    let colors = ctx.colors();
    let rels = part.rels.clone();
    let resolver = move |id: &str| rels.target_part(id);
    if let Some(pic) = doc.children(ole).find(|&c| doc.local(c) == "pic") {
        if let Some(bf) = doc.children(pic).find(|&c| doc.local(c) == "blipFill") {
            return parse_blip_fill(doc, bf, &colors, &resolver);
        }
    }
    None
}

/// Background of a slide-like part, resolved through layout and master.
pub fn background_fill(ctx: &SlideContext) -> Fill {
    let colors = ctx.colors();
    let parts: Vec<&PartRef> = [Some(&ctx.slide), ctx.layout.as_ref(), ctx.master.as_ref()].into_iter().flatten().collect();
    for p in parts {
        let doc = &p.doc;
        let Some(bg) = doc.path(doc.root(), Ns::P, &["cSld", "bg"]) else { continue };
        if let Some(pr) = doc.child(bg, Ns::P, "bgPr") {
            let rels = p.rels.clone();
            let resolver = move |id: &str| rels.target_part(id);
            if let Some(f) = find_fill(doc, pr, &colors, &resolver) {
                return f;
            }
        }
        if let Some(r) = doc.child(bg, Ns::P, "bgRef") {
            let idx = doc.attr_i64(r, "idx").unwrap_or(0).max(0) as u32;
            let color = find_color(doc, r, &colors);
            if let Some(node) = ctx.theme.fill_style(idx) {
                return super::fill::parse_fill(&ctx.theme.doc, node, &colors.with_ph(color), &|_| None);
            }
            if let Some(c) = color {
                return Fill::Solid(c);
            }
        }
    }
    Fill::Solid(Rgba::WHITE)
}

/// Whether master/layout shapes are shown behind a slide-like part.
pub fn shows_master_shapes(doc: &XmlDoc) -> bool {
    doc.attr_bool(doc.root(), "showMasterSp").unwrap_or(true)
}

#[cfg(test)]
mod test;
