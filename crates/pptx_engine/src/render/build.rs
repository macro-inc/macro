//! Builds the display list of a slide from the resolved model.

use super::paint::{ImageSource, fill_paint, line_stroke, shade_paint};
use super::scene::{Effect, Group, Node, Paint, Stroke};
use super::text::{LayoutParams, TextLayout, layout};
use crate::font::FontDb;
use crate::geometry::{self, PathFill, ShapeGeometry};
use crate::model::fill::{Effects, Fill, Line, LineEnd, LineEndKind};
use crate::model::presentation::{PartRef, SlideContext};
use crate::model::shape::{
    GeometryRef, Graphic, Inherit, Shape, ShapeKind, WalkCtx, background_fill, resolve_tree,
    shows_master_shapes, sp_tree,
};
use crate::model::text::TextBody;
use crate::path::{Affine, Path, PathEl, Point, Rect};
use crate::units::EMU_PER_PT;

/// Loads auxiliary parts while building (charts, SmartArt drawings, VML previews).
pub trait PartLoader: ImageSource {
    /// A parsed part.
    fn part(&mut self, name: &str) -> Option<PartRef>;
    /// A parsed metafile (EMF/WMF) image part, drawn as vectors.
    fn metafile(&mut self, part: &str) -> Option<std::sync::Arc<super::metafile::Metafile>>;
}

/// Which part of a slide to draw. Editors draw a shape being dragged or
/// typed into as its own layer over a backdrop of everything else.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    /// The whole slide.
    All,
    /// Everything except one top-level slide shape (or the group containing it).
    Without(u32),
    /// Only one top-level slide shape (or the group containing it), over transparency.
    Only(u32),
    /// The top-level slide shapes at z-order positions `start..end`, over
    /// the background and the layout and master shapes when `backdrop`, else
    /// over transparency. Slide shows draw animated shapes as layers this way.
    Span {
        /// First position (0 = backmost).
        start: usize,
        /// One past the last position.
        end: usize,
        /// Whether the background and inherited shapes are drawn beneath.
        backdrop: bool,
    },
}

/// Whether `s` is shape `id` or a group containing it.
fn contains_shape(s: &Shape, id: u32) -> bool {
    s.id == id
        || matches!(&s.kind, ShapeKind::Group(children) if children.iter().any(|c| contains_shape(c, id)))
}

/// Builds slide display lists.
pub struct Builder<'a> {
    /// Fonts for text.
    pub fonts: &'a FontDb,
    /// Part and image access.
    pub loader: &'a mut dyn PartLoader,
}

/// Minimum line width used to size arrowheads (0.7 mm, as Office does).
const ARROW_BASE_MIN: f32 = 1.984;

impl Builder<'_> {
    /// The full display list for a slide-like part.
    pub fn slide(&mut self, ctx: &SlideContext) -> Vec<Node> {
        self.slide_layer(ctx, Layer::All)
    }

    /// The display list of one layer of a slide (see [`Layer`]).
    pub fn slide_layer(&mut self, ctx: &SlideContext, layer: Layer) -> Vec<Node> {
        let (w, h) = (
            ctx.size.0 as f32 / EMU_PER_PT as f32,
            ctx.size.1 as f32 / EMU_PER_PT as f32,
        );
        let mut out = Vec::new();
        let backdrop = match layer {
            Layer::Only(_) => false,
            Layer::Span { backdrop, .. } => backdrop,
            Layer::All | Layer::Without(_) => true,
        };
        if backdrop {
            let page = Rect::from_xywh(0.0, 0.0, w, h);
            let bg = background_fill(ctx);
            if let Some(p) = fill_paint(&bg, page, &Affine::IDENTITY, self.loader) {
                out.push(Node::Fill {
                    path: Path::rect(page),
                    paint: p,
                    even_odd: false,
                });
            }
            let show_layout = shows_master_shapes(&ctx.slide.doc);
            let show_master = show_layout
                && ctx
                    .layout
                    .as_ref()
                    .is_none_or(|l| shows_master_shapes(&l.doc));
            if show_master && let Some(m) = &ctx.master {
                self.tree(ctx, m, Inherit::Master, true, Layer::All, &mut out);
            }
            if show_layout && let Some(l) = &ctx.layout {
                self.tree(ctx, l, Inherit::Layout, true, Layer::All, &mut out);
            }
        }
        let inherit = if ctx.master.is_none() && ctx.layout.is_none() {
            Inherit::Master
        } else {
            Inherit::Slide
        };
        let slide = ctx.slide.clone();
        self.tree(ctx, &slide, inherit, false, layer, &mut out);
        out
    }

    fn tree(
        &mut self,
        ctx: &SlideContext,
        part: &PartRef,
        inherit: Inherit,
        skip_placeholders: bool,
        layer: Layer,
        out: &mut Vec<Node>,
    ) {
        let Some(tree) = sp_tree(&part.doc) else {
            return;
        };
        let walk = WalkCtx { ctx, inherit };
        let shapes = resolve_tree(&walk, part, tree);
        for (i, s) in shapes.iter().enumerate() {
            if skip_placeholders && s.placeholder.is_some() {
                continue;
            }
            let selected = match layer {
                Layer::All => true,
                Layer::Without(id) => !contains_shape(s, id),
                Layer::Only(id) => contains_shape(s, id),
                Layer::Span { start, end, .. } => (start..end).contains(&i),
            };
            if selected {
                self.shape(ctx, s, &Affine::IDENTITY, None, out);
            }
        }
    }

    /// Appends the nodes of one shape (and its children) under `parent`.
    pub fn shape(
        &mut self,
        ctx: &SlideContext,
        s: &Shape,
        parent: &Affine,
        group_fill: Option<&Fill>,
        out: &mut Vec<Node>,
    ) {
        if s.hidden {
            return;
        }
        let world = parent.pre_concat(&s.xfrm.local_to_parent());
        let fill = match (&s.fill, group_fill) {
            (Fill::Group, Some(g)) => g.clone(),
            (f, _) => f.clone(),
        };
        let mut nodes: Vec<Node> = Vec::new();
        match &s.kind {
            ShapeKind::Group(children) => {
                let child_parent = world.pre_concat(&s.xfrm.child_to_local());
                for c in children {
                    self.shape(ctx, c, &child_parent, Some(&fill), &mut nodes);
                }
            }
            ShapeKind::Shape | ShapeKind::Connector => {
                let geom = self.geometry(s);
                self.geometry_nodes(s, &geom, &fill, &world, &mut nodes);
                if let Some(text) = &s.text {
                    self.text_nodes(s, &geom, text, parent, &mut nodes);
                }
            }
            ShapeKind::Picture(img) => {
                let geom = self.geometry(s);
                let bbox = Rect::from_xywh(0.0, 0.0, s.xfrm.w, s.xfrm.h);
                let clip = outline_path(&geom).transform(&world);
                // Pictures can also carry a background fill behind transparency.
                if let Some(p) = fill_paint(&fill, bbox, &world, self.loader) {
                    nodes.push(Node::Fill {
                        path: clip.clone(),
                        paint: p,
                        even_odd: false,
                    });
                }
                if let Some(img) = img {
                    if let Some(vector) = self.metafile_nodes(img, bbox, &world, &clip) {
                        nodes.push(vector);
                    } else if let Some(p) = fill_paint(
                        &Fill::Image(Box::new(img.clone())),
                        bbox,
                        &world,
                        self.loader,
                    ) {
                        nodes.push(Node::Fill {
                            path: clip.clone(),
                            paint: p,
                            even_odd: false,
                        });
                    } else {
                        placeholder_box(&clip, &mut nodes);
                    }
                }
                self.outline_nodes(s, &geom, &world, &mut nodes);
            }
            ShapeKind::Frame(g) => self.graphic(ctx, s, g, &world, &mut nodes),
        }
        wrap_effects(&s.effects, s.xfrm.rect(), parent, nodes, out);
    }

    /// Draws a stretched metafile picture as vectors, clipped to `clip`.
    fn metafile_nodes(
        &mut self,
        img: &crate::model::fill::ImageFill,
        bbox: Rect,
        world: &Affine,
        clip: &Path,
    ) -> Option<Node> {
        use crate::model::fill::ImageMode;
        let ImageMode::Stretch(fill_rect) = &img.mode else {
            return None;
        };
        if !img.effects.is_empty() {
            return None;
        }
        let m = self.loader.metafile(img.part.as_deref()?)?;
        let dest = Rect::from_ltrb(
            bbox.x + bbox.w * fill_rect.l,
            bbox.y + bbox.h * fill_rect.t,
            bbox.right() - bbox.w * fill_rect.r,
            bbox.bottom() - bbox.h * fill_rect.b,
        );
        let s = &img.src_rect;
        let (sx0, sy0) = (s.l * m.width_pt, s.t * m.height_pt);
        let sw = ((1.0 - s.r) * m.width_pt - sx0).abs().max(1e-3);
        let sh = ((1.0 - s.b) * m.height_pt - sy0).abs().max(1e-3);
        let t = world
            .pre_concat(&Affine::translate(f64::from(dest.x), f64::from(dest.y)))
            .pre_concat(&Affine::scale(
                f64::from(dest.w / sw),
                f64::from(dest.h / sh),
            ))
            .pre_concat(&Affine::translate(-f64::from(sx0), -f64::from(sy0)));
        let children = m.nodes.iter().map(|n| n.transformed(&t)).collect();
        Some(
            Group {
                children,
                opacity: 1.0,
                clip: Some(clip.clone()),
                effects: Vec::new(),
            }
            .into_node(),
        )
    }

    fn geometry(&self, s: &Shape) -> ShapeGeometry {
        shape_geometry(s)
    }

    fn geometry_nodes(
        &mut self,
        s: &Shape,
        geom: &ShapeGeometry,
        fill: &Fill,
        world: &Affine,
        out: &mut Vec<Node>,
    ) {
        let bbox = Rect::from_xywh(0.0, 0.0, s.xfrm.w, s.xfrm.h);
        let paint = fill_paint(fill, bbox, world, self.loader);
        if let Some(paint) = paint {
            for gp in &geom.paths {
                let paint = match gp.fill {
                    PathFill::None => continue,
                    PathFill::Norm => paint.clone(),
                    PathFill::Lighten => shade_paint(paint.clone(), 0.4, true),
                    PathFill::LightenLess => shade_paint(paint.clone(), 0.2, true),
                    PathFill::Darken => shade_paint(paint.clone(), 0.6, false),
                    PathFill::DarkenLess => shade_paint(paint.clone(), 0.8, false),
                };
                out.push(Node::Fill {
                    path: gp.path.transform(world),
                    paint,
                    even_odd: false,
                });
            }
        }
        self.outline_nodes(s, geom, world, out);
    }

    fn outline_nodes(
        &mut self,
        s: &Shape,
        geom: &ShapeGeometry,
        world: &Affine,
        out: &mut Vec<Node>,
    ) {
        let Some(line) = s.line.resolve() else { return };
        let bbox = Rect::from_xywh(0.0, 0.0, s.xfrm.w, s.xfrm.h);
        let Some(paint) = fill_paint(&line.fill, bbox, world, self.loader) else {
            return;
        };
        // Line weights are points: scaling a group does not change them.
        let stroke = line_stroke(&line, 1.0);
        for gp in geom.paths.iter().filter(|p| p.stroke) {
            let path = gp.path.transform(world);
            let closed = matches!(gp.path.els.last(), Some(PathEl::Close));
            if closed || (line.head.is_none() && line.tail.is_none()) {
                out.push(Node::Stroke {
                    path,
                    paint: paint.clone(),
                    stroke: stroke.clone(),
                });
            } else {
                let (shortened, heads) = arrowheads(&path, &line, stroke.width, &paint);
                out.push(Node::Stroke {
                    path: shortened,
                    paint: paint.clone(),
                    stroke: stroke.clone(),
                });
                out.extend(heads);
            }
        }
    }

    fn text_nodes(
        &mut self,
        s: &Shape,
        geom: &ShapeGeometry,
        text: &TextBody,
        parent: &Affine,
        out: &mut Vec<Node>,
    ) {
        if text.is_empty() {
            return;
        }
        let frame = text_frame(s, geom, text, parent);
        let lay = layout(
            text,
            frame.w,
            frame.h,
            self.fonts,
            LayoutParams::from_body(text),
        );
        let t = frame.transform.pre_concat(&lay.transform);
        let bbox = Rect::from_xywh(0.0, 0.0, frame.w, frame.h);
        if text.body.clip_overflow {
            let mut clipped = Vec::new();
            text_layout_nodes(self.fonts, &lay, &t, bbox, self.loader, &mut clipped);
            let clip = Path::rect(bbox).transform(&t);
            out.push(
                Group {
                    children: clipped,
                    opacity: 1.0,
                    clip: Some(clip),
                    effects: Vec::new(),
                }
                .into_node(),
            );
        } else {
            text_layout_nodes(self.fonts, &lay, &t, bbox, self.loader, out);
        }
    }

    fn graphic(
        &mut self,
        ctx: &SlideContext,
        s: &Shape,
        g: &Graphic,
        world: &Affine,
        out: &mut Vec<Node>,
    ) {
        let bbox = Rect::from_xywh(0.0, 0.0, s.xfrm.w, s.xfrm.h);
        match g {
            Graphic::Table(tbl) => super::table::table_nodes(self, ctx, s, *tbl, world, out),
            Graphic::Chart(part) => {
                if let Some(chart) = self.loader.part(part) {
                    super::chart::chart_nodes(self, ctx, &chart, bbox, world, out);
                }
            }
            Graphic::Diagram(data_part) => {
                if let Some(drawing) = self.diagram_drawing(&ctx.slide, data_part.as_deref()) {
                    let Some(tree) = drawing
                        .doc
                        .children(drawing.doc.root())
                        .find(|&c| drawing.doc.local(c) == "spTree")
                    else {
                        return;
                    };
                    let walk = WalkCtx {
                        ctx,
                        inherit: Inherit::Master,
                    };
                    let shapes = resolve_tree(&walk, &drawing, tree);
                    // Drawing coordinates are relative to the frame's top-left corner.
                    for c in &shapes {
                        self.shape(ctx, c, world, None, out);
                    }
                }
            }
            Graphic::Ole { preview, spid } => {
                let img = preview.clone().or_else(|| {
                    spid.as_deref()
                        .and_then(|id| self.vml_preview(&ctx.slide, id))
                });
                match img {
                    Some(img) => {
                        if let Some(p) =
                            fill_paint(&Fill::Image(Box::new(img)), bbox, world, self.loader)
                        {
                            out.push(Node::Fill {
                                path: Path::rect(bbox).transform(world),
                                paint: p,
                                even_odd: false,
                            });
                        }
                    }
                    None => placeholder_box(&Path::rect(bbox).transform(world), out),
                }
            }
            Graphic::Unknown => {}
        }
    }

    fn diagram_drawing(&mut self, slide: &PartRef, data_part: Option<&str>) -> Option<PartRef> {
        use crate::opc::rel_type;
        let data = self.loader.part(data_part?)?;
        // The data part's dataModelExt names the slide relationship of the drawing.
        let rel_id = data
            .doc
            .descendants(data.doc.root())
            .into_iter()
            .find(|&n| data.doc.local(n) == "dataModelExt")
            .and_then(|n| data.doc.attr(n, "relId").map(str::to_owned));
        let target = rel_id.and_then(|id| slide.target(&id)).or_else(|| {
            // Fallback: a drawing numbered like the data part.
            let digits: String = data.name.chars().filter(char::is_ascii_digit).collect();
            slide
                .rels
                .iter()
                .filter(|r| r.rel_type == rel_type::DIAGRAM_DRAWING)
                .map(|r| slide.rels.resolve(r))
                .find(|d| d.chars().filter(char::is_ascii_digit).collect::<String>() == digits)
        })?;
        self.loader.part(&target)
    }

    fn vml_preview(
        &mut self,
        slide: &PartRef,
        spid: &str,
    ) -> Option<crate::model::fill::ImageFill> {
        let vml_rel = slide
            .rels
            .iter()
            .find(|r| r.rel_type.ends_with("/vmlDrawing"))?;
        let vml = self.loader.part(&slide.rels.resolve(vml_rel))?;
        let doc = &vml.doc;
        let shape = doc.descendants(doc.root()).into_iter().find(|&n| {
            doc.local(n) == "shape"
                && (doc.attr_ns(n, crate::xml::Ns::O, "spid") == Some(spid)
                    || doc.attr(n, "id") == Some(spid))
        })?;
        let imagedata = doc
            .descendants(shape)
            .into_iter()
            .find(|&n| doc.local(n) == "imagedata")?;
        let rid = doc
            .attr_ns(imagedata, crate::xml::Ns::O, "relid")
            .or_else(|| doc.attr_ns(imagedata, crate::xml::Ns::R, "id"))?;
        let part = vml.target(rid)?;
        Some(crate::model::fill::ImageFill {
            part: Some(part),
            src_rect: Default::default(),
            mode: crate::model::fill::ImageMode::Stretch(Default::default()),
            effects: Vec::new(),
            rotate_with_shape: true,
        })
    }
}

/// Converts a laid-out text body into nodes under `t` (layout → scene).
pub fn text_layout_nodes(
    fonts: &FontDb,
    lay: &TextLayout,
    t: &Affine,
    bbox: Rect,
    images: &mut dyn ImageSource,
    out: &mut Vec<Node>,
) {
    for d in lay.decorations.iter().filter(|d| d.behind) {
        if let Some(p) = fill_paint(&d.fill, bbox, t, images) {
            out.push(Node::Fill {
                path: Path::rect(d.rect).transform(t),
                paint: p,
                even_odd: false,
            });
        }
    }
    for run in &lay.runs {
        let mut path = Path::new();
        let skew = if run.synthetic_italic { -0.2 } else { 0.0 };
        for g in &run.glyphs {
            let Some(outline) = fonts.outline(run.face, g.id) else {
                continue;
            };
            let origin = t.pre_concat(&Affine::translate(f64::from(g.x), f64::from(g.y)));
            let origin = if g.upright {
                origin.pre_concat(&Affine::rotate(-90.0))
            } else {
                origin
            };
            let gt = origin
                .pre_concat(&Affine {
                    a: 1.0,
                    b: 0.0,
                    c: skew,
                    d: 1.0,
                    e: 0.0,
                    f: 0.0,
                })
                .pre_concat(&Affine::scale(f64::from(run.size), f64::from(run.size)));
            path.extend(&outline.transform(&gt));
        }
        if path.is_empty() {
            continue;
        }
        let text_box = path.bounds().unwrap_or(bbox);
        let paint = match &run.fill {
            // Gradient text fills span the text box.
            Fill::Gradient(_) | Fill::Image(_) | Fill::Pattern { .. } => {
                fill_paint(&run.fill, bbox, t, images)
            }
            f => fill_paint(f, text_box, &Affine::IDENTITY, images),
        };
        let mut nodes = Vec::new();
        if let Some(p) = paint {
            nodes.push(Node::Fill {
                path: path.clone(),
                paint: p.clone(),
                even_odd: false,
            });
            if run.synthetic_bold {
                let stroke = Stroke {
                    width: run.size * 0.035 * t.mean_scale() as f32,
                    cap: super::scene::LineCap::Round,
                    join: super::scene::LineJoin::Round,
                    miter_limit: 4.0,
                    dash: None,
                };
                nodes.push(Node::Stroke {
                    path: path.clone(),
                    paint: p,
                    stroke,
                });
            }
        }
        if let Some(line) = run.outline.as_ref().and_then(|l| l.resolve())
            && let Some(p) = fill_paint(&line.fill, text_box, &Affine::IDENTITY, images)
        {
            nodes.push(Node::Stroke {
                path: path.clone(),
                paint: p,
                stroke: line_stroke(&line, t.mean_scale() as f32),
            });
        }
        if run.effects.is_empty() {
            out.extend(nodes);
        } else {
            let r = text_box;
            wrap_effects(&run.effects, r, &Affine::IDENTITY, nodes, out);
        }
    }
    for d in lay.decorations.iter().filter(|d| !d.behind) {
        if let Some(p) = fill_paint(&d.fill, bbox, t, images) {
            out.push(Node::Fill {
                path: Path::rect(d.rect).transform(t),
                paint: p,
                even_odd: false,
            });
        }
    }
    for shape in &lay.paths {
        if let Some(p) = fill_paint(&shape.fill, bbox, t, images) {
            out.push(Node::Fill {
                path: shape.path.transform(t),
                paint: p,
                even_odd: false,
            });
        }
    }
}

/// Where a shape's text is laid out: its text rectangle at the size the
/// shape is drawn (scaling a group resizes its shapes, not their text), and
/// the transform from that layout space to the scene.
#[derive(Clone, Copy, Debug)]
pub struct TextFrame {
    /// Layout width (points).
    pub w: f32,
    /// Layout height (points).
    pub h: f32,
    /// Layout space to scene.
    pub transform: Affine,
}

/// The text frame of `s` drawn through `parent` (the transform of its group).
pub fn text_frame(s: &Shape, geom: &ShapeGeometry, text: &TextBody, parent: &Affine) -> TextFrame {
    let rect = geom.text_rect;
    let base = parent.pre_concat(&s.xfrm.text_to_parent());
    let axis = |x: f64, y: f64| {
        let len = x.hypot(y);
        if len > 1e-9 { len } else { 1.0 }
    };
    // Group child coordinates may use other units than the slide; undo that
    // scale so text keeps its point size in the stretched box.
    let (sx, sy) = (axis(base.a, base.b), axis(base.c, base.d));
    let (w, h) = (rect.w * sx as f32, rect.h * sy as f32);
    let mut t = base
        .pre_concat(&Affine::translate(f64::from(rect.x), f64::from(rect.y)))
        .pre_concat(&Affine::scale(1.0 / sx, 1.0 / sy));
    if text.body.rot != 0.0 {
        let c = (f64::from(w / 2.0), f64::from(h / 2.0));
        t = t
            .pre_concat(&Affine::translate(c.0, c.1))
            .pre_concat(&Affine::rotate(f64::from(text.body.rot)))
            .pre_concat(&Affine::translate(-c.0, -c.1));
    }
    TextFrame { w, h, transform: t }
}

/// The evaluated geometry (paths and text rectangle) of a resolved shape.
pub fn shape_geometry(s: &Shape) -> ShapeGeometry {
    let (w, h) = (
        f64::from(s.xfrm.w) * EMU_PER_PT,
        f64::from(s.xfrm.h) * EMU_PER_PT,
    );
    match &s.geometry {
        GeometryRef::Preset(name, adj) => geometry::preset(name, w, h, adj)
            .or_else(|| geometry::preset("rect", w, h, &[]))
            .unwrap_or_default(),
        GeometryRef::Custom(part, node) => geometry::custom(&part.doc, *node, w, h),
    }
}

/// Wraps nodes in a layer with the shape's effects (if any).
pub fn wrap_effects(
    fx: &Effects,
    rect: Rect,
    parent: &Affine,
    nodes: Vec<Node>,
    out: &mut Vec<Node>,
) {
    if fx.is_empty() || nodes.is_empty() {
        out.extend(nodes);
        return;
    }
    // Effect sizes are points: scaling a group does not change them.
    let mut effects = Vec::new();
    if let Some(g) = &fx.glow {
        effects.push(Effect::Glow {
            color: g.color,
            radius: g.radius,
        });
    }
    if let Some(sh) = &fx.outer_shadow {
        let rad = f64::from(sh.dir).to_radians();
        let offset = Point::new(
            (f64::from(sh.dist) * rad.cos()) as f32,
            (f64::from(sh.dist) * rad.sin()) as f32,
        );
        // Scale/skew about the alignment anchor of the shape box (scene coordinates).
        let bounds = Path::rect(rect).transform(parent).bounds().unwrap_or(rect);
        let (ax, ay) = anchor(&sh.align, bounds);
        let m = Affine {
            a: f64::from(sh.sx),
            b: f64::from(sh.ky).to_radians().tan(),
            c: f64::from(sh.kx).to_radians().tan(),
            d: f64::from(sh.sy),
            e: 0.0,
            f: 0.0,
        };
        let transform = Affine::translate(f64::from(ax), f64::from(ay))
            .pre_concat(&m)
            .pre_concat(&Affine::translate(-f64::from(ax), -f64::from(ay)));
        effects.push(Effect::OuterShadow {
            color: sh.color,
            blur: sh.blur,
            offset,
            transform,
        });
    }
    if let Some(sh) = &fx.inner_shadow {
        let rad = f64::from(sh.dir).to_radians();
        let offset = Point::new(
            (f64::from(sh.dist) * rad.cos()) as f32,
            (f64::from(sh.dist) * rad.sin()) as f32,
        );
        effects.push(Effect::InnerShadow {
            color: sh.color,
            blur: sh.blur,
            offset,
        });
    }
    if let Some(r) = fx.soft_edge {
        effects.push(Effect::SoftEdge { radius: r });
    }
    if let Some(r) = &fx.reflection {
        let bounds = Path::rect(rect).transform(parent).bounds().unwrap_or(rect);
        effects.push(Effect::Reflection {
            axis: bounds.bottom(),
            dist: r.dist,
            start_alpha: r.start_alpha,
            end_alpha: r.end_alpha,
            end_pos: r.end_pos,
            height: bounds.h,
            blur: r.blur,
        });
    }
    out.push(
        Group {
            children: nodes,
            opacity: 1.0,
            clip: None,
            effects,
        }
        .into_node(),
    );
}

fn anchor(align: &str, r: Rect) -> (f32, f32) {
    let x = match align {
        "tl" | "l" | "bl" => r.x,
        "tr" | "r" | "br" => r.right(),
        _ => r.x + r.w / 2.0,
    };
    let y = match align {
        "tl" | "t" | "tr" => r.y,
        "bl" | "b" | "br" => r.bottom(),
        _ => r.y + r.h / 2.0,
    };
    (x, y)
}

/// The union of a geometry's filled sub-paths (used to clip pictures).
fn outline_path(geom: &ShapeGeometry) -> Path {
    let mut p = Path::new();
    for gp in geom.paths.iter().filter(|g| g.fill != PathFill::None) {
        p.extend(&gp.path);
    }
    if p.is_empty() {
        for gp in &geom.paths {
            p.extend(&gp.path);
        }
    }
    p
}

fn placeholder_box(path: &Path, out: &mut Vec<Node>) {
    use crate::model::color::Rgba;
    out.push(Node::Fill {
        path: path.clone(),
        paint: Paint::Solid(Rgba::from_u8(0xF2, 0xF2, 0xF2)),
        even_odd: false,
    });
    out.push(Node::Stroke {
        path: path.clone(),
        paint: Paint::Solid(Rgba::from_u8(0xBF, 0xBF, 0xBF)),
        stroke: Stroke {
            width: 0.75,
            cap: super::scene::LineCap::Butt,
            join: super::scene::LineJoin::Miter,
            miter_limit: 4.0,
            dash: None,
        },
    });
}

fn first_tangent(path: &Path) -> Option<(Point, Point)> {
    let mut start = None;
    for el in &path.els {
        match *el {
            PathEl::MoveTo(p) => start = Some(p),
            PathEl::LineTo(p) | PathEl::QuadTo(p, _) | PathEl::CubicTo(p, _, _) => {
                let s = start?;
                if (p.x - s.x).abs() + (p.y - s.y).abs() > 1e-3 {
                    return Some((s, p));
                }
                if let PathEl::CubicTo(_, c2, e) = *el {
                    let q = if (c2.x - s.x).abs() + (c2.y - s.y).abs() > 1e-3 {
                        c2
                    } else {
                        e
                    };
                    return Some((s, q));
                }
            }
            PathEl::Close => {}
        }
    }
    None
}

fn last_tangent(path: &Path) -> Option<(Point, Point)> {
    let mut prev = None;
    let mut result = None;
    for el in &path.els {
        match *el {
            PathEl::MoveTo(p) => prev = Some(p),
            PathEl::LineTo(p) => {
                if let Some(a) = prev
                    && (p.x - a.x).abs() + (p.y - a.y).abs() > 1e-3
                {
                    result = Some((p, a));
                }
                prev = Some(p);
            }
            PathEl::QuadTo(c, p) => {
                result = Some((p, c));
                prev = Some(p);
            }
            PathEl::CubicTo(_, c2, p) => {
                let from = if (c2.x - p.x).abs() + (c2.y - p.y).abs() > 1e-3 {
                    c2
                } else {
                    prev.unwrap_or(c2)
                };
                result = Some((p, from));
                prev = Some(p);
            }
            PathEl::Close => {}
        }
    }
    result
}

/// Builds arrowheads for an open path and returns the path shortened so the
/// stroke ends inside each head.
fn arrowheads(path: &Path, line: &Line, width: f32, paint: &Paint) -> (Path, Vec<Node>) {
    let mut nodes = Vec::new();
    let mut p = path.clone();
    let base = width.max(ARROW_BASE_MIN);
    let mut handle = |end: LineEnd, tip: Point, from: Point, at_start: bool, p: &mut Path| {
        let (dx, dy) = (tip.x - from.x, tip.y - from.y);
        let len = (dx * dx + dy * dy).sqrt().max(1e-6);
        let (ux, uy) = (dx / len, dy / len);
        let (nx, ny) = (-uy, ux);
        let (aw, al) = (end.w * base, end.len * base);
        let pt = |back: f32, side: f32| {
            Point::new(tip.x - ux * back + nx * side, tip.y - uy * back + ny * side)
        };
        let mut head = Path::new();
        let mut shorten = 0.0;
        match end.kind {
            LineEndKind::Triangle => {
                head.move_to(tip);
                head.line_to(pt(al, aw / 2.0));
                head.line_to(pt(al, -aw / 2.0));
                head.close();
                shorten = al * 0.9;
            }
            LineEndKind::Stealth => {
                head.move_to(tip);
                head.line_to(pt(al, aw / 2.0));
                head.line_to(pt(al * 0.6, 0.0));
                head.line_to(pt(al, -aw / 2.0));
                head.close();
                shorten = al * 0.55;
            }
            LineEndKind::Diamond => {
                head.move_to(pt(-al / 2.0, 0.0));
                head.line_to(pt(0.0, aw / 2.0));
                head.line_to(pt(al / 2.0, 0.0));
                head.line_to(pt(0.0, -aw / 2.0));
                head.close();
            }
            LineEndKind::Oval => {
                let r = Rect::from_xywh(-al / 2.0, -aw / 2.0, al, aw);
                let rot = f64::from(uy).atan2(f64::from(ux)).to_degrees();
                head = Path::ellipse(r).transform(
                    &Affine::translate(f64::from(tip.x), f64::from(tip.y))
                        .pre_concat(&Affine::rotate(rot)),
                );
            }
            LineEndKind::Arrow => {
                let mut open = Path::new();
                open.move_to(pt(al, aw / 2.0));
                open.line_to(tip);
                open.line_to(pt(al, -aw / 2.0));
                nodes.push(Node::Stroke {
                    path: open,
                    paint: paint.clone(),
                    stroke: Stroke {
                        width,
                        cap: super::scene::LineCap::Round,
                        join: super::scene::LineJoin::Miter,
                        miter_limit: 10.0,
                        dash: None,
                    },
                });
                shorten = width / 2.0;
            }
            LineEndKind::None => {}
        }
        if !head.is_empty() {
            nodes.push(Node::Fill {
                path: head,
                paint: paint.clone(),
                even_odd: false,
            });
        }
        if shorten > 0.0 {
            let newp = Point::new(tip.x - ux * shorten, tip.y - uy * shorten);
            move_endpoint(p, at_start, newp);
        }
    };
    if let (Some(head), Some((tip, next))) = (line.head, first_tangent(path)) {
        handle(head, tip, next, true, &mut p);
    }
    if let (Some(tail), Some((tip, prev))) = (line.tail, last_tangent(path)) {
        handle(tail, tip, prev, false, &mut p);
    }
    (p, nodes)
}

fn move_endpoint(p: &mut Path, at_start: bool, to: Point) {
    if at_start {
        if let Some(PathEl::MoveTo(pt)) = p.els.first_mut() {
            *pt = to;
        }
    } else if let Some(el) = p.els.iter_mut().rev().find(|e| !matches!(e, PathEl::Close)) {
        match el {
            PathEl::LineTo(pt) | PathEl::QuadTo(_, pt) | PathEl::CubicTo(_, _, pt) => *pt = to,
            PathEl::MoveTo(_) | PathEl::Close => {}
        }
    }
}
