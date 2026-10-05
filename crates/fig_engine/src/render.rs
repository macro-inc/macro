//! Rasterizing part of a page with tiny-skia.
//!
//! Drawing follows Figma's compositing model. A node draws, in order: its
//! drop shadows, its background blur, its fills, its inner shadows, its
//! children (clipped to its shape when it clips content), and its strokes.
//! Opacity below 1, a blend mode, a layer blur, or a drop shadow isolate the
//! node in its own layer, composited afterwards. A mask layer masks its
//! following siblings until the next mask or the end of its parent.
//!
//! Layers are sized to the node's bounds within the region being rendered,
//! so isolated nodes cost what they cover, not a full surface.

mod effects;
pub(crate) mod paint;
mod text;

use crate::document::Document;
use crate::geometry::{self, ParsedPath};
use crate::images::ImageStore;
use crate::model::{
    Affine, Color, EffectKind, MaskType, NodeType, Props, Rect, StrokeAlign, WindingRule,
};
use crate::scene::{Scene, SceneIdx};
use std::sync::Arc;
use tiny_skia::{FillRule, Mask, Path, PathBuilder, Pixmap, PixmapPaint, Transform};

/// What to draw: a page rectangle starting at `(x, y)` (page units) at
/// `scale` device pixels per unit, `width × height` pixels.
#[derive(Clone, Copy, Debug)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RenderOptions {
    /// Figma's outline view: every shape as a hairline, no paint.
    pub outline: bool,
    /// Fill the region with this color first (the page canvas color).
    pub background: Option<Color>,
}

/// A pixmap whose pixel (0, 0) is device pixel `(ox, oy)`.
pub(crate) struct Surface {
    pub pixmap: Pixmap,
    pub ox: i32,
    pub oy: i32,
}

impl Surface {
    fn new(ox: i32, oy: i32, w: u32, h: u32) -> Option<Surface> {
        Some(Surface {
            pixmap: Pixmap::new(w.max(1), h.max(1))?,
            ox,
            oy,
        })
    }

    fn device_rect(&self) -> Rect {
        Rect::new(
            f64::from(self.ox),
            f64::from(self.oy),
            f64::from(self.pixmap.width()),
            f64::from(self.pixmap.height()),
        )
    }
}

/// Largest layer side; pathological bounds are clamped to the region.
const MAX_LAYER_SIDE: u32 = 8192;

pub(crate) struct Painter<'a> {
    pub doc: &'a Document,
    pub scene: &'a Scene,
    pub images: &'a mut ImageStore,
    pub opts: RenderOptions,
    /// Page → device.
    pub base: Affine,
    pub scale: f64,
    /// Device-space region being drawn (with margin).
    pub region: Rect,
}

/// Renders a viewport of a scene into a premultiplied RGBA pixmap.
pub fn render(
    doc: &Document,
    scene: &Scene,
    images: &mut ImageStore,
    vp: &Viewport,
    opts: RenderOptions,
) -> Option<Pixmap> {
    let base = Affine::scale(vp.scale, vp.scale).mul(&Affine::translate(-vp.x, -vp.y));
    let region = Rect::new(0.0, 0.0, f64::from(vp.width), f64::from(vp.height));
    let mut painter = Painter {
        doc,
        scene,
        images,
        opts,
        base,
        scale: vp.scale,
        region,
    };
    // Effects sample beyond what they cover: render with a margin so blurs
    // and shadows from just outside the region are complete inside it.
    let margin = painter.effect_margin(scene.root()).ceil().min(1024.0) as i32;
    let (w, h) = (vp.width as i32 + 2 * margin, vp.height as i32 + 2 * margin);
    let mut surface = Surface::new(-margin, -margin, w as u32, h as u32)?;
    painter.region = surface.device_rect();
    if let Some(bg) = opts.background {
        surface.pixmap.fill(bg.to_skia());
    }
    let children = scene.node(scene.root()).children.clone();
    painter.draw_children(&children, &mut surface, None);
    if margin == 0 {
        return Some(surface.pixmap);
    }
    surface.pixmap.clone_rect(tiny_skia::IntRect::from_xywh(
        margin, margin, vp.width, vp.height,
    )?)
}

/// Renders one node by itself (its own bounds, transparent background) at
/// `scale` device pixels per unit, as Figma's export does.
pub fn render_node(
    doc: &Document,
    scene: &Scene,
    images: &mut ImageStore,
    node: SceneIdx,
    scale: f64,
    opts: RenderOptions,
) -> Option<Pixmap> {
    let bounds = scene.node(node).bounds;
    if bounds.is_empty() {
        return None;
    }
    let vp = Viewport {
        x: bounds.x,
        y: bounds.y,
        scale,
        width: ((bounds.w * scale).ceil() as u32).clamp(1, MAX_LAYER_SIDE),
        height: ((bounds.h * scale).ceil() as u32).clamp(1, MAX_LAYER_SIDE),
    };
    let base = Affine::scale(scale, scale).mul(&Affine::translate(-vp.x, -vp.y));
    let mut painter = Painter {
        doc,
        scene,
        images,
        opts,
        base,
        scale,
        region: Rect::new(0.0, 0.0, f64::from(vp.width), f64::from(vp.height)),
    };
    let mut surface = Surface::new(0, 0, vp.width, vp.height)?;
    if let Some(bg) = opts.background {
        surface.pixmap.fill(bg.to_skia());
    }
    painter.draw_node(node, &mut surface, None);
    Some(surface.pixmap)
}

pub(crate) fn fill_rule(w: WindingRule) -> FillRule {
    match w {
        WindingRule::NonZero => FillRule::Winding,
        WindingRule::EvenOdd => FillRule::EvenOdd,
    }
}

/// A shape to fill: a geometry blob or a computed path.
pub(crate) enum Shape {
    Blob(Arc<ParsedPath>, FillRule),
    Owned(Path, FillRule),
}

impl Shape {
    pub fn path(&self) -> &Path {
        match self {
            Shape::Blob(p, _) => &p.path,
            Shape::Owned(p, _) => p,
        }
    }

    pub fn rule(&self) -> FillRule {
        match self {
            Shape::Blob(_, r) | Shape::Owned(_, r) => *r,
        }
    }
}

impl<'a> Painter<'a> {
    fn props(&self, i: SceneIdx) -> &'a Props {
        self.scene.props(self.doc, i)
    }

    /// Node → surface transform.
    fn node_transform(&self, i: SceneIdx, surface: &Surface) -> Affine {
        Affine::translate(-f64::from(surface.ox), -f64::from(surface.oy))
            .mul(&self.base)
            .mul(&self.scene.node(i).world)
    }

    /// Page rect → device rect.
    fn to_device(&self, r: &Rect) -> Rect {
        self.base.map_rect(r)
    }

    /// How far (device pixels) effects in the subtree reach beyond their
    /// node's geometry, for nodes that intersect the region.
    fn effect_margin(&self, i: SceneIdx) -> f64 {
        let node = self.scene.node(i);
        let mut margin: f64 = 0.0;
        let props = self.props(i);
        if i != self.scene.root() {
            if !props.visible() || !self.to_device(&node.bounds).intersects(&self.region) {
                return 0.0;
            }
            for e in props.effects().iter().filter(|e| e.is_visible()) {
                let reach = match e.kind {
                    EffectKind::DropShadow | EffectKind::InnerShadow => {
                        f64::from(e.radius) * 1.5
                            + f64::from(e.spread.abs())
                            + e.offset.x.abs().max(e.offset.y.abs())
                    }
                    EffectKind::LayerBlur | EffectKind::BackgroundBlur => f64::from(e.radius) * 1.5,
                    EffectKind::Other => 0.0,
                };
                margin = margin.max(reach * node.world.scale_factor() * self.scale);
            }
        }
        for &c in &node.children {
            margin = margin.max(self.effect_margin(c));
        }
        margin
    }

    pub(crate) fn draw_children(
        &mut self,
        children: &[SceneIdx],
        surface: &mut Surface,
        clip: Option<&Mask>,
    ) {
        let mut k = 0;
        while k < children.len() {
            let c = children[k];
            let props = self.props(c);
            if props.is_mask() && props.visible() && !self.opts.outline {
                let mut end = k + 1;
                while end < children.len() && !self.props(children[end]).is_mask() {
                    end += 1;
                }
                self.draw_masked(c, &children[k + 1..end], surface, clip);
                k = end;
            } else {
                self.draw_node(c, surface, clip);
                k += 1;
            }
        }
    }

    /// A mask and the siblings it masks.
    fn draw_masked(
        &mut self,
        mask_node: SceneIdx,
        content: &[SceneIdx],
        surface: &mut Surface,
        clip: Option<&Mask>,
    ) {
        let mask_bounds = self.to_device(&self.scene.node(mask_node).bounds);
        let area = mask_bounds.intersect(&surface.device_rect());
        let Some(mut layer) = self.layer(&area) else {
            return;
        };
        for &c in content {
            self.draw_node(c, &mut layer, None);
        }
        let Some(mut mask_layer) = Surface::new(
            layer.ox,
            layer.oy,
            layer.pixmap.width(),
            layer.pixmap.height(),
        ) else {
            return;
        };
        let props = self.props(mask_node);
        let mask_type = props.mask_type.unwrap_or_default();
        match mask_type {
            MaskType::Outline => {
                let ts = self.node_transform(mask_node, &mask_layer).to_skia();
                let paint = solid_paint(Color::BLACK);
                for shape in self.shapes(mask_node) {
                    mask_layer
                        .pixmap
                        .fill_path(shape.path(), &paint, shape.rule(), ts, None);
                }
            }
            MaskType::Alpha | MaskType::Luminance => {
                self.draw_node_content(mask_node, &mut mask_layer, None, true);
            }
        }
        let mask = Mask::from_pixmap(
            mask_layer.pixmap.as_ref(),
            if mask_type == MaskType::Luminance {
                tiny_skia::MaskType::Luminance
            } else {
                tiny_skia::MaskType::Alpha
            },
        );
        layer.pixmap.apply_mask(&mask);
        composite(surface, &layer, 1.0, tiny_skia::BlendMode::SourceOver, clip);
    }

    /// A transparent layer covering `device` (clamped to the region).
    fn layer(&self, device: &Rect) -> Option<Surface> {
        let r = device.intersect(&self.region);
        if r.is_empty() || r.w < 0.5 && r.h < 0.5 {
            return None;
        }
        let x0 = r.x.floor() as i32;
        let y0 = r.y.floor() as i32;
        let x1 = r.right().ceil() as i32;
        let y1 = r.bottom().ceil() as i32;
        let w = ((x1 - x0).max(1) as u32).min(MAX_LAYER_SIDE);
        let h = ((y1 - y0).max(1) as u32).min(MAX_LAYER_SIDE);
        Surface::new(x0, y0, w, h)
    }

    pub(crate) fn draw_node(&mut self, i: SceneIdx, surface: &mut Surface, clip: Option<&Mask>) {
        let props = self.props(i);
        if !props.visible() {
            return;
        }
        let node = self.scene.node(i);
        let device = self.to_device(&node.bounds);
        if !device.intersects(&surface.device_rect()) || !device.intersects(&self.region) {
            return;
        }
        if device.w < 0.25 && device.h < 0.25 {
            return;
        }
        let node_type = props.node_type();
        if matches!(node_type, NodeType::Slice) {
            return;
        }
        let opacity = props.opacity();
        if opacity <= 0.0 {
            return;
        }
        if self.opts.outline {
            self.draw_outline(i, surface, clip);
            return;
        }
        let blend = props.blend_mode();
        let effects = props.effects();
        let has_layer_blur = effects
            .iter()
            .any(|e| e.is_visible() && e.kind == EffectKind::LayerBlur && e.radius > 0.0);
        let has_drop_shadow = effects
            .iter()
            .any(|e| e.is_visible() && e.kind == EffectKind::DropShadow);
        let has_background_blur = effects
            .iter()
            .any(|e| e.is_visible() && e.kind == EffectKind::BackgroundBlur && e.radius > 0.0);

        if has_background_blur {
            self.background_blur(i, surface, clip);
        }

        let simple = self.is_simple(i, props);
        let isolate =
            has_layer_blur || has_drop_shadow || !blend.is_normal() || (opacity < 1.0 && !simple);
        if !isolate {
            let fold = if opacity < 1.0 { opacity } else { 1.0 };
            self.draw_node_content_with_opacity(i, surface, clip, false, fold);
            return;
        }
        let Some(mut layer) = self.layer(&device.intersect(&surface.device_rect())) else {
            return;
        };
        self.draw_node_content(i, &mut layer, None, false);
        for e in effects.iter().filter(|e| e.is_visible()) {
            if e.kind == EffectKind::LayerBlur && e.radius > 0.0 {
                let sigma = f64::from(e.radius) / 2.0 * node.world.scale_factor() * self.scale;
                effects::blur_pixmap(&mut layer.pixmap, sigma as f32);
            }
        }
        if has_drop_shadow {
            let Some(mut with_shadows) = Surface::new(
                layer.ox,
                layer.oy,
                layer.pixmap.width(),
                layer.pixmap.height(),
            ) else {
                return;
            };
            let scale = node.world.scale_factor() * self.scale;
            for e in effects
                .iter()
                .filter(|e| e.is_visible() && e.kind == EffectKind::DropShadow)
            {
                let offset = self.device_vector(i, e.offset);
                effects::drop_shadow(&mut with_shadows.pixmap, &layer.pixmap, e, offset, scale);
            }
            with_shadows.pixmap.draw_pixmap(
                0,
                0,
                layer.pixmap.as_ref(),
                &PixmapPaint::default(),
                Transform::identity(),
                None,
            );
            layer = with_shadows;
        }
        composite(surface, &layer, opacity, blend.to_skia(), clip);
    }

    /// A node offset vector (e.g. a shadow offset) in device pixels.
    fn device_vector(&self, i: SceneIdx, v: crate::model::Vec2) -> (f32, f32) {
        let w = self.base.mul(&self.scene.node(i).world);
        (
            (w.m00 * v.x + w.m01 * v.y) as f32,
            (w.m10 * v.x + w.m11 * v.y) as f32,
        )
    }

    /// Whether opacity can be applied to the node's single paint instead of
    /// isolating it in a layer.
    fn is_simple(&self, i: SceneIdx, props: &Props) -> bool {
        if !props.effects().iter().all(|e| !e.is_visible()) {
            return false;
        }
        let drawn_children = props.node_type().draws_children()
            && self
                .scene
                .node(i)
                .children
                .iter()
                .any(|&c| self.props(c).visible());
        if drawn_children {
            return false;
        }
        let fills = props.fills().iter().filter(|p| p.is_visible()).count();
        let strokes = if props.has_visible_strokes() {
            props.strokes().iter().filter(|p| p.is_visible()).count()
        } else {
            0
        };
        if props.node_type() == NodeType::Text {
            // Glyphs do not overlap, so one paint per glyph folds safely.
            return fills <= 1 && strokes == 0;
        }
        fills + strokes <= 1
    }

    fn draw_node_content(
        &mut self,
        i: SceneIdx,
        surface: &mut Surface,
        clip: Option<&Mask>,
        as_mask: bool,
    ) {
        self.draw_node_content_with_opacity(i, surface, clip, as_mask, 1.0);
    }

    /// Fills, inner shadows, children, strokes.
    fn draw_node_content_with_opacity(
        &mut self,
        i: SceneIdx,
        surface: &mut Surface,
        clip: Option<&Mask>,
        _as_mask: bool,
        opacity: f32,
    ) {
        let props = self.props(i);
        let node_type = props.node_type();
        let ts = self.node_transform(i, surface);
        let size = props.size();

        if node_type == NodeType::Text {
            self.draw_text(i, props, &ts, surface, clip, opacity);
        } else if props.has_visible_fills() {
            let shapes = self.fill_shapes(i);
            for paint in props.fills().iter().filter(|p| p.is_visible()) {
                for shape in &shapes {
                    self.fill_shape(surface, shape, &ts, paint, size, opacity, clip);
                }
            }
        }

        let inner: Vec<_> = props
            .effects()
            .iter()
            .filter(|e| e.is_visible() && e.kind == EffectKind::InnerShadow)
            .cloned()
            .collect();
        if !inner.is_empty() {
            self.inner_shadows(i, &inner, surface, clip);
        }

        if node_type.draws_children() {
            let children = &self.scene.node(i).children;
            if !children.is_empty() {
                let children = children.clone();
                if props.clips_content() {
                    let mask = self.clip_mask(i, surface, clip);
                    match mask {
                        ClipResult::Mask(m) => self.draw_children(&children, surface, Some(&m)),
                        ClipResult::Unchanged => self.draw_children(&children, surface, clip),
                        ClipResult::Empty => {}
                    }
                } else {
                    self.draw_children(&children, surface, clip);
                }
            }
        }

        // Text draws its own strokes, clipped to its glyphs.
        if props.has_visible_strokes() && node_type != NodeType::Text {
            self.draw_strokes(i, props, &ts, surface, clip, opacity);
        }
    }

    /// The shapes a node's fills cover: its fill geometry, or for frames and
    /// rectangles without stored geometry, its (rounded) box.
    pub(crate) fn fill_shapes(&self, i: SceneIdx) -> Vec<Shape> {
        let props = self.props(i);
        let mut shapes: Vec<Shape> = props
            .fill_geometry()
            .iter()
            .filter_map(|g| {
                self.doc
                    .blobs
                    .path(g.blob)
                    .map(|p| Shape::Blob(p, fill_rule(g.winding)))
            })
            .collect();
        if shapes.is_empty() {
            let size = props.size();
            let boxy = props.node_type().is_frame_like()
                || matches!(
                    props.node_type(),
                    NodeType::Rectangle | NodeType::RoundedRectangle
                );
            if props.node_type() == NodeType::Ellipse
                && let Some(rect) =
                    tiny_skia::Rect::from_xywh(0.0, 0.0, size.x as f32, size.y as f32)
                && let Some(p) = PathBuilder::from_oval(rect)
            {
                shapes.push(Shape::Owned(p, FillRule::Winding));
            } else if boxy
                && let Some(p) = geometry::rounded_rect(
                    size.x as f32,
                    size.y as f32,
                    props.radii(),
                    props.corner_smoothing.unwrap_or(0.0),
                )
            {
                shapes.push(Shape::Owned(p, FillRule::Winding));
            }
        }
        shapes
    }

    /// Every shape the node draws (fills, else strokes), for masks.
    fn shapes(&self, i: SceneIdx) -> Vec<Shape> {
        let mut shapes = self.fill_shapes(i);
        if shapes.is_empty() {
            let props = self.props(i);
            shapes.extend(props.stroke_geometry().iter().filter_map(|g| {
                self.doc
                    .blobs
                    .path(g.blob)
                    .map(|p| Shape::Blob(p, fill_rule(g.winding)))
            }));
        }
        shapes
    }

    fn draw_strokes(
        &mut self,
        i: SceneIdx,
        props: &Props,
        ts: &Affine,
        surface: &mut Surface,
        clip: Option<&Mask>,
        opacity: f32,
    ) {
        let geometry: Vec<Shape> = props
            .stroke_geometry()
            .iter()
            .filter_map(|g| {
                self.doc
                    .blobs
                    .path(g.blob)
                    .map(|p| Shape::Blob(p, fill_rule(g.winding)))
            })
            .collect();
        let shapes = if geometry.is_empty() {
            self.fallback_stroke(i, props)
        } else {
            geometry
        };
        if shapes.is_empty() {
            return;
        }
        // Figma stores inside and outside strokes at twice their weight,
        // centered; the half outside (inside) the fill shape is clipped off.
        let align = props.stroke_align();
        let mut owned_clip = None;
        if align != StrokeAlign::Center && !geometry_is_open(props) {
            let fill = self.fill_shapes(i);
            if !fill.is_empty() {
                let mut shape_mask =
                    match Mask::new(surface.pixmap.width(), surface.pixmap.height()) {
                        Some(m) => m,
                        None => return,
                    };
                let sts = ts.to_skia();
                for s in &fill {
                    shape_mask.fill_path(s.path(), s.rule(), true, sts);
                }
                if align == StrokeAlign::Outside {
                    shape_mask.invert();
                }
                if let Some(parent) = clip {
                    multiply_masks(&mut shape_mask, parent);
                }
                owned_clip = Some(shape_mask);
            }
        }
        let clip = owned_clip.as_ref().or(clip);
        let size = props.size();
        for paint in props.strokes().iter().filter(|p| p.is_visible()) {
            for shape in &shapes {
                self.fill_shape(surface, shape, ts, paint, size, opacity, clip);
            }
        }
    }

    /// Strokes computed here for nodes whose file has no stroke geometry
    /// (rare: some frames and older files).
    /// A stroke outline for a shape saved without stroke geometry: its fill
    /// shapes (or its box) stroked, doubled for inside and outside strokes,
    /// which are clipped to one side afterwards.
    fn fallback_stroke(&self, i: SceneIdx, props: &Props) -> Vec<Shape> {
        if props.node_type() == NodeType::Line {
            return line_stroke(props);
        }
        let weight = props.stroke_weight();
        let width = match props.stroke_align() {
            StrokeAlign::Center => weight,
            _ => weight * 2.0,
        };
        let stroke = tiny_skia::Stroke {
            width,
            ..Default::default()
        };
        let mut outlines: Vec<Path> = self
            .fill_shapes(i)
            .iter()
            .map(|s| s.path().clone())
            .collect();
        if outlines.is_empty() {
            let size = props.size();
            outlines.extend(geometry::rounded_rect(
                size.x as f32,
                size.y as f32,
                props.radii(),
                props.corner_smoothing.unwrap_or(0.0),
            ));
        }
        outlines
            .iter()
            .filter_map(|p| p.stroke(&stroke, 1.0))
            .map(|p| Shape::Owned(p, FillRule::Winding))
            .collect()
    }

    /// Hairline outlines for outline view.
    fn draw_outline(&mut self, i: SceneIdx, surface: &mut Surface, clip: Option<&Mask>) {
        let props = self.props(i);
        let ts = self.node_transform(i, surface).to_skia();
        let paint = solid_paint(Color::BLACK);
        let hairline = tiny_skia::Stroke {
            width: 0.0,
            ..Default::default()
        };
        let node_type = props.node_type();
        if node_type == NodeType::Text {
            if let Some(layout) = &props.text_layout {
                for g in layout.glyphs.iter() {
                    let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                        continue;
                    };
                    let gts = ts
                        .pre_translate(g.x, g.y)
                        .pre_scale(g.font_size, -g.font_size);
                    surface
                        .pixmap
                        .fill_path(&path.path, &paint, FillRule::Winding, gts, clip);
                }
            }
        } else {
            let mut shapes = self.fill_shapes(i);
            if shapes.is_empty() {
                shapes = self.shapes(i);
            }
            for s in &shapes {
                surface
                    .pixmap
                    .stroke_path(s.path(), &paint, &hairline, ts, clip);
            }
        }
        if node_type.draws_children() {
            let children = self.scene.node(i).children.clone();
            for c in children {
                self.draw_node(c, surface, clip);
            }
        }
    }

    fn clip_mask(&self, i: SceneIdx, surface: &Surface, parent: Option<&Mask>) -> ClipResult {
        let props = self.props(i);
        let ts = self.node_transform(i, surface);
        let size = props.size();
        // A plain axis-aligned box that covers the whole surface clips nothing.
        let radii = props.radii();
        if radii.is_zero() && ts.m01 == 0.0 && ts.m10 == 0.0 {
            let r = ts.map_rect(&Rect::new(0.0, 0.0, size.x, size.y));
            let s = Rect::new(
                0.0,
                0.0,
                f64::from(surface.pixmap.width()),
                f64::from(surface.pixmap.height()),
            );
            if r.x <= s.x && r.y <= s.y && r.right() >= s.right() && r.bottom() >= s.bottom() {
                return ClipResult::Unchanged;
            }
            if !r.intersects(&s) {
                return ClipResult::Empty;
            }
        }
        let shapes = self.fill_shapes(i);
        let Some(mut mask) = Mask::new(surface.pixmap.width(), surface.pixmap.height()) else {
            return ClipResult::Empty;
        };
        if shapes.is_empty() {
            return ClipResult::Empty;
        }
        let sts = ts.to_skia();
        for s in &shapes {
            mask.fill_path(s.path(), s.rule(), true, sts);
        }
        if let Some(p) = parent {
            multiply_masks(&mut mask, p);
        }
        ClipResult::Mask(mask)
    }
}

enum ClipResult {
    Mask(Mask),
    Unchanged,
    Empty,
}

/// A line drawn from its size: a segment along x with Figma's caps, and an
/// arrowhead at the end for the arrow caps.
fn line_stroke(props: &Props) -> Vec<Shape> {
    let len = props.size().x as f32;
    let weight = props.stroke_weight().max(0.01);
    let cap = props.stroke_cap.as_deref().unwrap_or("NONE");
    let mut pb = tiny_skia::PathBuilder::new();
    pb.move_to(0.0, 0.0);
    pb.line_to(len, 0.0);
    let arrow = cap.starts_with("ARROW");
    if arrow {
        // Arrowhead lines back from the tip, as long as Figma draws them.
        let head = (weight * 3.5).max(6.0);
        let (dx, dy) = (head * 0.866, head * 0.5);
        pb.move_to(len - dx, -dy);
        pb.line_to(len, 0.0);
        pb.line_to(len - dx, dy);
        if cap == "ARROW_EQUILATERAL" {
            pb.close();
        }
    }
    let Some(path) = pb.finish() else {
        return Vec::new();
    };
    let stroke = tiny_skia::Stroke {
        width: weight,
        line_cap: match cap {
            "ROUND" => tiny_skia::LineCap::Round,
            "SQUARE" => tiny_skia::LineCap::Square,
            _ if arrow => tiny_skia::LineCap::Round,
            _ => tiny_skia::LineCap::Butt,
        },
        line_join: if arrow {
            tiny_skia::LineJoin::Round
        } else {
            tiny_skia::LineJoin::Miter
        },
        ..Default::default()
    };
    let mut shapes: Vec<Shape> = path
        .stroke(&stroke, 1.0)
        .map(|p| Shape::Owned(p, FillRule::Winding))
        .into_iter()
        .collect();
    if cap == "ARROW_EQUILATERAL" {
        let head = (weight * 3.5).max(6.0);
        let mut tri = tiny_skia::PathBuilder::new();
        tri.move_to(len, 0.0);
        tri.line_to(len - head * 0.866, -head * 0.5);
        tri.line_to(len - head * 0.866, head * 0.5);
        tri.close();
        if let Some(t) = tri.finish() {
            shapes.push(Shape::Owned(t, FillRule::Winding));
        }
    }
    shapes
}

/// Whether a node's geometry is an open path (lines and open vectors have
/// no inside, so stroke alignment does not apply).
fn geometry_is_open(props: &Props) -> bool {
    matches!(props.node_type(), NodeType::Line)
        || props.fill_geometry().is_empty() && matches!(props.node_type(), NodeType::Vector)
}

pub(crate) fn multiply_masks(dst: &mut Mask, src: &Mask) {
    for (a, b) in dst.data_mut().iter_mut().zip(src.data()) {
        *a = ((u16::from(*a) * u16::from(*b) + 127) / 255) as u8;
    }
}

pub(crate) fn solid_paint(c: Color) -> tiny_skia::Paint<'static> {
    let mut p = tiny_skia::Paint::default();
    p.set_color(c.to_skia());
    p.anti_alias = true;
    p
}

/// Draws `layer` onto `surface` at its device position.
fn composite(
    surface: &mut Surface,
    layer: &Surface,
    opacity: f32,
    blend: tiny_skia::BlendMode,
    clip: Option<&Mask>,
) {
    surface.pixmap.draw_pixmap(
        layer.ox - surface.ox,
        layer.oy - surface.oy,
        layer.pixmap.as_ref(),
        &PixmapPaint {
            opacity,
            blend_mode: blend,
            quality: tiny_skia::FilterQuality::Nearest,
        },
        Transform::identity(),
        clip,
    );
}

#[cfg(test)]
mod test;
