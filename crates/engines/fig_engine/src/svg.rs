//! SVG export: a layer and everything it holds as an SVG document, the way
//! Figma's "Export as SVG" writes one.
//!
//! The document covers the layer's render bounds (effects included). Shapes
//! are paths from their geometry, so corner radii, booleans, and vector
//! networks come out as drawn; text is outlined into glyph paths. Solid,
//! linear, and radial paints map to SVG paints (diamond gradients become
//! radial ones and angular gradients their average color); image fills
//! embed the image as a PNG. Frames clip their content with a clip path,
//! masks become SVG masks, opacity and blend modes apply to groups, and
//! drop shadows, inner shadows, and layer blurs become filters, as in
//! Figma's export. Background blurs have no SVG equivalent and are left out.

use crate::document::Document;
use crate::edit::shapes::box_shape;
use crate::geometry::rounded_rect;
use crate::model::{
    Affine, BlendMode, Color, ColorStop, EffectKind, GradientKind, ImageScaleMode, MaskType,
    NodeType, Paint, PaintKind, Props, Rect, StrokeAlign, Vec2, WindingRule,
};
use crate::scene::{Scene, SceneIdx};
use std::fmt::Write;
use tiny_skia::{Path, PathBuilder, PathSegment};

/// Figma's SVG export options.
#[derive(Clone, Copy, Debug)]
pub struct SvgOptions {
    /// Text as glyph outlines (Figma's default) rather than `<text>`.
    pub outline_text: bool,
    /// An `id` (the layer's name) on every layer.
    pub include_ids: bool,
}

impl Default for SvgOptions {
    fn default() -> Self {
        SvgOptions {
            outline_text: true,
            include_ids: false,
        }
    }
}

/// The layer `node` as an SVG document; `None` when it draws nothing.
pub fn export(doc: &Document, scene: &Scene, node: SceneIdx) -> Option<String> {
    export_with(doc, scene, node, SvgOptions::default())
}

/// [`export`] with Figma's options.
pub fn export_with(
    doc: &Document,
    scene: &Scene,
    node: SceneIdx,
    opts: SvgOptions,
) -> Option<String> {
    let bounds = scene.node(node).bounds;
    if bounds.is_empty() {
        return None;
    }
    let mut w = Writer {
        doc,
        scene,
        origin: Affine::translate(-bounds.x, -bounds.y),
        defs: String::new(),
        next_id: 0,
        opts,
        names: std::collections::HashMap::new(),
    };
    let mut body = String::new();
    w.node(node, &mut body);
    let (width, height) = (num(bounds.w), num(bounds.h));
    let mut out = format!(
        "<svg width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n"
    );
    out.push_str(&body);
    if !w.defs.is_empty() {
        let _ = write!(out, "<defs>\n{}</defs>\n", w.defs);
    }
    out.push_str("</svg>\n");
    Some(out)
}

struct Writer<'a> {
    doc: &'a Document,
    scene: &'a Scene,
    /// Page → document coordinates.
    origin: Affine,
    defs: String,
    next_id: u32,
    opts: SvgOptions,
    /// Layer ids given out, for making repeated names unique.
    names: std::collections::HashMap<String, u32>,
}

/// Text escaped for XML content and attributes.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if (c as u32) < 0x20 && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// The CSS weight a Figma style name stands for.
fn font_weight(style: &str) -> u16 {
    let s = style.to_ascii_lowercase().replace([' ', '-'], "");
    [
        ("thin", 100),
        ("hairline", 100),
        ("extralight", 200),
        ("ultralight", 200),
        ("light", 300),
        ("medium", 500),
        ("semibold", 600),
        ("demibold", 600),
        ("extrabold", 800),
        ("ultrabold", 800),
        ("black", 900),
        ("heavy", 900),
        ("bold", 700),
    ]
    .into_iter()
    .find(|(name, _)| s.contains(name))
    .map_or(400, |(_, w)| w)
}

/// A number as SVG writes it: at most three decimals, no trailing zeros.
fn num(v: f64) -> String {
    let s = format!("{:.3}", if v.abs() < 5e-4 { 0.0 } else { v });
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

fn matrix(t: &Affine) -> String {
    format!(
        "matrix({} {} {} {} {} {})",
        num(t.m00),
        num(t.m10),
        num(t.m01),
        num(t.m11),
        num(t.m02),
        num(t.m12)
    )
}

/// Path data for `path` mapped by `t`.
fn path_data(path: &Path, t: &Affine) -> String {
    let mut out = String::new();
    let p = |q: tiny_skia::Point| {
        let v = t.apply(Vec2::new(f64::from(q.x), f64::from(q.y)));
        format!("{} {}", num(v.x), num(v.y))
    };
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(a) => {
                let _ = write!(out, "M{}", p(a));
            }
            PathSegment::LineTo(a) => {
                let _ = write!(out, "L{}", p(a));
            }
            PathSegment::QuadTo(c, a) => {
                let _ = write!(out, "Q{} {}", p(c), p(a));
            }
            PathSegment::CubicTo(c1, c2, a) => {
                let _ = write!(out, "C{} {} {}", p(c1), p(c2), p(a));
            }
            PathSegment::Close => out.push('Z'),
        }
    }
    out
}

fn hex(c: Color) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02X}{:02X}{:02X}", b(c.r), b(c.g), b(c.b))
}

fn rule_attr(rule: WindingRule) -> &'static str {
    match rule {
        WindingRule::NonZero => "",
        WindingRule::EvenOdd => " fill-rule=\"evenodd\" clip-rule=\"evenodd\"",
    }
}

/// CSS's name for a blend mode, when it is not plain source-over.
fn blend_css(b: BlendMode) -> Option<&'static str> {
    use BlendMode::*;
    Some(match b {
        PassThrough | Normal => return None,
        Darken => "darken",
        Multiply | LinearBurn => "multiply",
        ColorBurn => "color-burn",
        Lighten => "lighten",
        Screen | LinearDodge => "screen",
        ColorDodge => "color-dodge",
        Overlay => "overlay",
        SoftLight => "soft-light",
        HardLight => "hard-light",
        Difference => "difference",
        Exclusion => "exclusion",
        Hue => "hue",
        Saturation => "saturation",
        Color => "color",
        Luminosity => "luminosity",
    })
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(BASE64[(n >> 18) as usize & 63] as char);
        out.push(BASE64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// The average color of a gradient (for angular gradients).
fn mean_color(stops: &[ColorStop]) -> Color {
    let n = stops.len().max(1) as f32;
    let sum = stops.iter().fold([0.0f32; 4], |acc, s| {
        [
            acc[0] + s.color.r,
            acc[1] + s.color.g,
            acc[2] + s.color.b,
            acc[3] + s.color.a,
        ]
    });
    Color {
        r: sum[0] / n,
        g: sum[1] / n,
        b: sum[2] / n,
        a: sum[3] / n,
    }
}

/// The node's fill shapes in its own space: its fill geometry, or the box
/// its size draws (frames, rectangles, ellipses).
pub(crate) fn fill_shapes(doc: &Document, scene: &Scene, i: SceneIdx) -> Vec<(Path, WindingRule)> {
    let p = scene.props(doc, i);
    let shapes: Vec<(Path, WindingRule)> = p
        .fill_geometry()
        .iter()
        .filter_map(|g| Some((doc.blobs.path(g.blob)?.path.clone(), g.winding)))
        .collect();
    if !shapes.is_empty() {
        return shapes;
    }
    let t = p.node_type();
    let boxy = t.is_frame_like()
        || matches!(
            t,
            NodeType::Rectangle | NodeType::RoundedRectangle | NodeType::Ellipse
        );
    if !boxy {
        return Vec::new();
    }
    let size = p.size();
    let path = if t == NodeType::Ellipse {
        box_shape(p)
    } else {
        rounded_rect(
            size.x as f32,
            size.y as f32,
            p.radii(),
            p.corner_smoothing.unwrap_or(0.0),
        )
    };
    path.map(|p| vec![(p, WindingRule::NonZero)])
        .unwrap_or_default()
}

impl Writer<'_> {
    fn id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}{}", self.next_id)
    }

    fn props(&self, i: SceneIdx) -> &Props {
        self.scene.props(self.doc, i)
    }

    /// Node → document transform.
    fn world(&self, i: SceneIdx) -> Affine {
        self.origin.mul(&self.scene.node(i).world)
    }

    fn fill_shapes(&self, i: SceneIdx) -> Vec<(Path, WindingRule)> {
        fill_shapes(self.doc, self.scene, i)
    }

    fn node(&mut self, i: SceneIdx, out: &mut String) {
        let p = self.props(i);
        if !p.visible() || p.opacity() <= 0.0 || p.node_type() == NodeType::Slice {
            return;
        }
        let mut attrs = String::new();
        if self.opts.include_ids {
            let name = p.name().to_owned();
            let id = self.layer_id(&name);
            let _ = write!(attrs, " id=\"{}\"", escape(&id));
        }
        let p = self.props(i);
        if p.opacity() < 1.0 {
            let _ = write!(attrs, " opacity=\"{}\"", num(f64::from(p.opacity())));
        }
        if let Some(css) = blend_css(p.blend_mode()) {
            let _ = write!(attrs, " style=\"mix-blend-mode:{css}\"");
        }
        if let Some(f) = self.filter(i) {
            let _ = write!(attrs, " filter=\"url(#{f})\"");
        }
        let mut content = String::new();
        self.content(i, &mut content);
        if attrs.is_empty() {
            out.push_str(&content);
        } else {
            let _ = write!(out, "<g{attrs}>\n{content}</g>\n");
        }
    }

    /// Fills, container strokes, children, and shape strokes.
    fn content(&mut self, i: SceneIdx, out: &mut String) {
        let p = self.props(i);
        let world = self.world(i);
        if p.node_type() == NodeType::Text && !self.opts.outline_text {
            self.text_elements(i, out);
        } else if p.node_type() == NodeType::Text {
            self.text(i, out);
        } else if p.has_visible_fills() {
            let shapes = self.fill_shapes(i);
            let fills: Vec<Paint> = p
                .fills()
                .iter()
                .filter(|f| f.is_visible())
                .cloned()
                .collect();
            let size = p.size();
            for paint in &fills {
                for (path, rule) in &shapes {
                    self.fill(path, *rule, &world, paint, size, out);
                }
            }
        }
        let container_stroke =
            self.props(i).node_type().is_frame_like() && !self.props(i).clips_content();
        if container_stroke && self.props(i).has_visible_strokes() {
            self.strokes(i, out);
        }
        let p = self.props(i);
        if p.node_type().draws_children() && !self.scene.node(i).children.is_empty() {
            let mut inner = String::new();
            let children = self.scene.node(i).children.clone();
            self.children(&children, &mut inner);
            if self.props(i).clips_content() && !inner.is_empty() {
                let shapes = self.fill_shapes(i);
                if shapes.is_empty() {
                    out.push_str(&inner);
                } else {
                    let id = self.clip(&shapes, &world);
                    let _ = write!(out, "<g clip-path=\"url(#{id})\">\n{inner}</g>\n");
                }
            } else {
                out.push_str(&inner);
            }
        }
        if self.props(i).has_visible_strokes() && !container_stroke {
            self.strokes(i, out);
        }
    }

    /// Children in order; a mask masks the siblings above it.
    fn children(&mut self, children: &[SceneIdx], out: &mut String) {
        let mut k = 0;
        while k < children.len() {
            let c = children[k];
            let p = self.props(c);
            if p.is_mask() && p.visible() {
                let mut end = k + 1;
                while end < children.len() && !self.props(children[end]).is_mask() {
                    end += 1;
                }
                let mut masked = String::new();
                for &s in &children[k + 1..end] {
                    self.node(s, &mut masked);
                }
                if !masked.is_empty() {
                    let id = self.mask(c);
                    let _ = write!(out, "<g mask=\"url(#{id})\">\n{masked}</g>\n");
                }
                k = end;
            } else {
                self.node(c, out);
                k += 1;
            }
        }
    }

    fn mask(&mut self, m: SceneIdx) -> String {
        let id = self.id("mask");
        let p = self.props(m);
        let kind = p.mask_type.unwrap_or_default();
        let b = self.origin.map_rect(&self.scene.node(m).bounds);
        let mut content = String::new();
        match kind {
            MaskType::Outline => {
                let world = self.world(m);
                for (path, rule) in self.fill_shapes(m) {
                    let _ = writeln!(
                        content,
                        "<path d=\"{}\" fill=\"#000000\"{}/>",
                        path_data(&path, &world),
                        rule_attr(rule)
                    );
                }
            }
            MaskType::Alpha | MaskType::Luminance => self.content(m, &mut content),
        }
        let style = if kind == MaskType::Luminance {
            "luminance"
        } else {
            "alpha"
        };
        let _ = write!(
            self.defs,
            "<mask id=\"{id}\" style=\"mask-type:{style}\" maskUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\">\n{content}</mask>\n",
            num(b.x),
            num(b.y),
            num(b.w),
            num(b.h)
        );
        id
    }

    /// A clip path of `shapes` (node space) placed by `world`.
    fn clip(&mut self, shapes: &[(Path, WindingRule)], world: &Affine) -> String {
        let id = self.id("clip");
        let _ = writeln!(self.defs, "<clipPath id=\"{id}\">");
        for (path, rule) in shapes {
            let _ = writeln!(
                self.defs,
                "<path d=\"{}\"{}/>",
                path_data(path, world),
                rule_attr(*rule)
            );
        }
        self.defs.push_str("</clipPath>\n");
        id
    }

    /// The SVG paint (`fill` or `stroke` attributes) for `paint`, defining
    /// gradients in node space; `None` for images and unsupported paints.
    fn paint_attrs(&mut self, paint: &Paint, size: Vec2, attr: &str) -> Option<String> {
        let mut s = String::new();
        match &paint.kind {
            PaintKind::Solid(c) => {
                let _ = write!(s, " {attr}=\"{}\"", hex(*c));
                let a = c.a * paint.opacity;
                if a < 1.0 {
                    let _ = write!(s, " {attr}-opacity=\"{}\"", num(f64::from(a)));
                }
            }
            PaintKind::Gradient {
                kind: GradientKind::Angular,
                stops,
                ..
            } => {
                let c = mean_color(stops);
                let _ = write!(s, " {attr}=\"{}\"", hex(c));
                let a = c.a * paint.opacity;
                if a < 1.0 {
                    let _ = write!(s, " {attr}-opacity=\"{}\"", num(f64::from(a)));
                }
            }
            PaintKind::Gradient {
                kind,
                stops,
                transform,
            } => {
                let inv = transform.invert()?;
                let to_node = Affine::scale(size.x.max(1e-6), size.y.max(1e-6)).mul(&inv);
                let id = self.id("paint");
                let shape = if *kind == GradientKind::Linear {
                    format!("<linearGradient id=\"{id}\" x1=\"0\" y1=\"0.5\" x2=\"1\" y2=\"0.5\"")
                } else {
                    format!("<radialGradient id=\"{id}\" cx=\"0.5\" cy=\"0.5\" r=\"0.5\"")
                };
                let _ = writeln!(
                    self.defs,
                    "{shape} gradientUnits=\"userSpaceOnUse\" gradientTransform=\"{}\">",
                    matrix(&to_node)
                );
                let mut sorted = stops.to_vec();
                sorted.sort_by(|a, b| a.position.total_cmp(&b.position));
                for stop in &sorted {
                    let _ = write!(
                        self.defs,
                        "<stop offset=\"{}\" stop-color=\"{}\"",
                        num(f64::from(stop.position.clamp(0.0, 1.0))),
                        hex(stop.color)
                    );
                    let a = stop.color.a * paint.opacity;
                    if a < 1.0 {
                        let _ = write!(self.defs, " stop-opacity=\"{}\"", num(f64::from(a)));
                    }
                    self.defs.push_str("/>\n");
                }
                self.defs.push_str(if *kind == GradientKind::Linear {
                    "</linearGradient>\n"
                } else {
                    "</radialGradient>\n"
                });
                let _ = write!(s, " {attr}=\"url(#{id})\"");
            }
            PaintKind::Pattern(pattern) => {
                let tile = crate::render::pattern::render_tile(
                    self.doc,
                    &mut crate::images::ImageStore::default(),
                    pattern,
                    4.0,
                    &[],
                )?;
                let id = self.id("pattern");
                let data = base64(&crate::images::encode_png(&tile.pixmap));
                let (w, h) = (tile.pixmap.width(), tile.pixmap.height());
                let _ = writeln!(
                    self.defs,
                    "<pattern id=\"{id}\" patternUnits=\"userSpaceOnUse\" width=\"{w}\" height=\"{h}\" patternTransform=\"{}\"><image width=\"{w}\" height=\"{h}\" href=\"data:image/png;base64,{data}\"/></pattern>",
                    matrix(&tile.transform(pattern, size))
                );
                let _ = write!(
                    s,
                    " {attr}=\"url(#{id})\" {attr}-opacity=\"{}\"",
                    num(f64::from(paint.opacity))
                );
            }
            PaintKind::Image(_) | PaintKind::Unsupported(_) => return None,
        }
        if let Some(css) = blend_css(paint.blend_mode) {
            let _ = write!(s, " style=\"mix-blend-mode:{css}\"");
        }
        Some(s)
    }

    /// Fills `path` (node space) with `paint`.
    fn fill(
        &mut self,
        path: &Path,
        rule: WindingRule,
        world: &Affine,
        paint: &Paint,
        size: Vec2,
        out: &mut String,
    ) {
        if let PaintKind::Image(_) = paint.kind {
            self.image(path, rule, world, paint, size, out);
            return;
        }
        let Some(attrs) = self.paint_attrs(paint, size, "fill") else {
            return;
        };
        if matches!(paint.kind, PaintKind::Solid(_)) {
            let _ = writeln!(
                out,
                "<path d=\"{}\"{}{attrs}/>",
                path_data(path, world),
                rule_attr(rule)
            );
        } else {
            // Gradients are defined in node space.
            let _ = writeln!(
                out,
                "<path d=\"{}\" transform=\"{}\"{}{attrs}/>",
                path_data(path, &Affine::IDENTITY),
                matrix(world),
                rule_attr(rule)
            );
        }
    }

    /// An image fill: the image placed by its scale mode, clipped to the
    /// shape (tiled images as a pattern).
    fn image(
        &mut self,
        path: &Path,
        rule: WindingRule,
        world: &Affine,
        paint: &Paint,
        size: Vec2,
        out: &mut String,
    ) {
        let PaintKind::Image(img) = &paint.kind else {
            return;
        };
        let decoded = img
            .hash
            .as_deref()
            .and_then(|h| self.doc.images.get(h))
            .and_then(|bytes| Some((bytes, crate::images::decode(bytes)?)));
        let Some((bytes, pixmap)) = decoded else {
            // A missing image shows Figma's neutral placeholder.
            let mut placeholder = paint.clone();
            placeholder.kind = PaintKind::Solid(Color {
                r: 0.9,
                g: 0.9,
                b: 0.9,
                a: 1.0,
            });
            self.fill(path, rule, world, &placeholder, size, out);
            return;
        };
        let (iw, ih) = (f64::from(pixmap.width()), f64::from(pixmap.height()));
        let Some(to_node) = crate::render::paint::image_transform(img, iw, ih, size) else {
            return;
        };
        let png = if bytes.starts_with(b"\x89PNG") {
            base64(bytes)
        } else {
            base64(&crate::images::encode_png(&pixmap))
        };
        let href = format!("data:image/png;base64,{png}");
        let mut extra = String::new();
        if paint.opacity < 1.0 {
            let _ = write!(extra, " opacity=\"{}\"", num(f64::from(paint.opacity)));
        }
        if let Some(css) = blend_css(paint.blend_mode) {
            let _ = write!(extra, " style=\"mix-blend-mode:{css}\"");
        }
        if img.scale_mode == ImageScaleMode::Tile {
            let id = self.id("pattern");
            let _ = writeln!(
                self.defs,
                "<pattern id=\"{id}\" patternUnits=\"userSpaceOnUse\" width=\"{}\" height=\"{}\" patternTransform=\"{}\"><image width=\"{}\" height=\"{}\" href=\"{href}\"/></pattern>",
                num(iw),
                num(ih),
                matrix(&to_node),
                num(iw),
                num(ih)
            );
            let _ = writeln!(
                out,
                "<path d=\"{}\" transform=\"{}\"{} fill=\"url(#{id})\"{extra}/>",
                path_data(path, &Affine::IDENTITY),
                matrix(world),
                rule_attr(rule)
            );
            return;
        }
        let clip = self.clip(&[(path.clone(), rule)], world);
        let _ = writeln!(
            out,
            "<g clip-path=\"url(#{clip})\"{extra}><image width=\"{}\" height=\"{}\" preserveAspectRatio=\"none\" transform=\"{}\" href=\"{href}\"/></g>",
            num(iw),
            num(ih),
            matrix(&world.mul(&to_node))
        );
    }

    /// Strokes: the stored outline filled, or the shape stroked; inside and
    /// outside strokes cut to their side of the fill.
    fn strokes(&mut self, i: SceneIdx, out: &mut String) {
        let p = self.props(i).clone();
        let world = self.world(i);
        let size = p.size();
        let paints: Vec<Paint> = p
            .strokes()
            .iter()
            .filter(|s| s.is_visible())
            .cloned()
            .collect();
        let fill_shapes = if p.node_type() == NodeType::Text {
            self.glyph_shapes(&p)
        } else {
            self.fill_shapes(i)
        };
        let open = p.node_type() == NodeType::Line
            || p.node_type() == NodeType::Vector && p.fill_geometry().is_empty();
        let mut body = String::new();
        let stored: Vec<(Path, WindingRule)> = p
            .stroke_geometry()
            .iter()
            .filter_map(|g| Some((self.doc.blobs.path(g.blob)?.path.clone(), g.winding)))
            .collect();
        if !stored.is_empty() {
            for paint in &paints {
                for (path, rule) in &stored {
                    self.fill(path, *rule, &world, paint, size, &mut body);
                }
            }
        } else if p.node_type() != NodeType::Text {
            let lines: Vec<Path> = if p.node_type() == NodeType::Line {
                let mut pb = PathBuilder::new();
                pb.move_to(0.0, 0.0);
                pb.line_to(size.x as f32, 0.0);
                pb.finish().into_iter().collect()
            } else {
                fill_shapes.iter().map(|s| s.0.clone()).collect()
            };
            let width = if open || p.stroke_align() == StrokeAlign::Center {
                p.stroke_weight()
            } else {
                p.stroke_weight() * 2.0
            };
            let mut style = format!(" stroke-width=\"{}\"", num(f64::from(width)));
            if let Some(cap) = p.stroke_cap.as_deref() {
                let cap = match cap {
                    "ROUND" | "ARROW_LINES" | "ARROW_EQUILATERAL" => "round",
                    "SQUARE" => "square",
                    _ => "",
                };
                if !cap.is_empty() {
                    let _ = write!(style, " stroke-linecap=\"{cap}\"");
                }
            }
            match p.stroke_join.as_deref() {
                Some("ROUND") => style.push_str(" stroke-linejoin=\"round\""),
                Some("BEVEL") => style.push_str(" stroke-linejoin=\"bevel\""),
                _ => {}
            }
            if let Some(dash) = p.dash_pattern.as_deref().filter(|d| !d.is_empty()) {
                let d: Vec<String> = dash.iter().map(|v| num(f64::from(*v))).collect();
                let _ = write!(style, " stroke-dasharray=\"{}\"", d.join(" "));
            }
            for paint in &paints {
                let Some(attrs) = self.paint_attrs(paint, size, "stroke") else {
                    continue;
                };
                for path in &lines {
                    let _ = writeln!(
                        body,
                        "<path d=\"{}\" transform=\"{}\"{style}{attrs}/>",
                        path_data(path, &Affine::IDENTITY),
                        matrix(&world)
                    );
                }
            }
        }
        if body.is_empty() {
            return;
        }
        let align = p.stroke_align();
        if open || align == StrokeAlign::Center || fill_shapes.is_empty() {
            out.push_str(&body);
        } else if align == StrokeAlign::Inside {
            let clip = self.clip(&fill_shapes, &world);
            let _ = write!(out, "<g clip-path=\"url(#{clip})\">\n{body}</g>\n");
        } else {
            // Outside: everything but the fill shape.
            let id = self.id("mask");
            let b = self.origin.map_rect(&self.scene.node(i).bounds).outset(1.0);
            let _ = writeln!(
                self.defs,
                "<mask id=\"{id}\" maskUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\">",
                num(b.x),
                num(b.y),
                num(b.w),
                num(b.h)
            );
            let _ = writeln!(
                self.defs,
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"#FFFFFF\"/>",
                num(b.x),
                num(b.y),
                num(b.w),
                num(b.h)
            );
            for (path, rule) in &fill_shapes {
                let _ = writeln!(
                    self.defs,
                    "<path d=\"{}\" fill=\"#000000\"{}/>",
                    path_data(path, &world),
                    rule_attr(*rule)
                );
            }
            self.defs.push_str("</mask>\n");
            let _ = write!(out, "<g mask=\"url(#{id})\">\n{body}</g>\n");
        }
    }

    /// A text layer's glyphs as one shape (what its strokes are cut to).
    fn glyph_shapes(&self, p: &Props) -> Vec<(Path, WindingRule)> {
        let Some(layout) = &p.text_layout else {
            return Vec::new();
        };
        let mut pb = PathBuilder::new();
        for g in layout.glyphs.iter() {
            let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                continue;
            };
            let fs = f64::from(g.font_size);
            let t = Affine::translate(f64::from(g.x), f64::from(g.y)).mul(&Affine::scale(fs, -fs));
            if let Some(glyph) = path.path.clone().transform(t.to_skia()) {
                pb.push_path(&glyph);
            }
        }
        pb.finish()
            .map(|p| vec![(p, WindingRule::NonZero)])
            .unwrap_or_default()
    }

    /// Text as glyph outlines, filled run by run with each style's paints.
    fn text(&mut self, i: SceneIdx, out: &mut String) {
        let p = self.props(i).clone();
        let Some(layout) = p.text_layout.clone() else {
            return;
        };
        let world = self.world(i);
        let size = p.size();
        let fills_for = |style: u32| -> Vec<Paint> {
            let run = p
                .text_content
                .as_ref()
                .and_then(|c| c.styles.iter().find(|r| r.id == style))
                .and_then(|r| r.fills.clone());
            run.unwrap_or_else(|| p.fills.clone().unwrap_or_else(|| std::sync::Arc::from([])))
                .iter()
                .filter(|f| f.is_visible())
                .cloned()
                .collect()
        };
        // Consecutive glyphs sharing a style are one path.
        let mut runs: Vec<(u32, PathBuilder)> = Vec::new();
        for g in layout.glyphs.iter() {
            let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                continue;
            };
            if runs.last().is_none_or(|r| r.0 != g.style_id) {
                runs.push((g.style_id, PathBuilder::new()));
            }
            let fs = f64::from(g.font_size);
            let t = Affine::translate(f64::from(g.x), f64::from(g.y)).mul(&Affine::scale(fs, -fs));
            if let Some(glyph) = path.path.clone().transform(t.to_skia())
                && let Some(last) = runs.last_mut()
            {
                last.1.push_path(&glyph);
            }
        }
        for deco in layout.decorations.iter() {
            let mut pb = PathBuilder::new();
            for r in deco.rects.iter() {
                if let Some(rect) =
                    tiny_skia::Rect::from_xywh(r[0], r[1], r[2].max(0.01), r[3].max(0.01))
                {
                    pb.push_rect(rect);
                }
            }
            runs.push((deco.style_id, pb));
        }
        for (style, pb) in runs {
            let Some(path) = pb.finish() else { continue };
            for paint in fills_for(style) {
                self.fill(&path, WindingRule::NonZero, &world, &paint, size, out);
            }
        }
    }

    /// A filter for the node's drop shadows, inner shadows, and layer blur,
    /// built the way Figma's export writes them.
    fn filter(&mut self, i: SceneIdx) -> Option<String> {
        let p = self.props(i);
        let effects: Vec<_> = p
            .effects()
            .iter()
            .filter(|e| {
                e.is_visible()
                    && matches!(
                        e.kind,
                        EffectKind::DropShadow | EffectKind::InnerShadow | EffectKind::LayerBlur
                    )
            })
            .cloned()
            .collect();
        if effects.is_empty() {
            return None;
        }
        let world = self.world(i);
        let scale = world.scale_factor();
        let region: Rect = self.origin.map_rect(&self.scene.node(i).bounds).outset(1.0);
        let id = self.id("filter");
        let mut f = format!(
            "<filter id=\"{id}\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\">\n<feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/>\n",
            num(region.x),
            num(region.y),
            num(region.w),
            num(region.h)
        );
        const HARD_ALPHA: &str = "<feColorMatrix in=\"SourceAlpha\" type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0\" result=\"hardAlpha\"/>\n";
        let color = |c: Color| {
            format!(
                "<feColorMatrix type=\"matrix\" values=\"0 0 0 0 {} 0 0 0 0 {} 0 0 0 0 {} 0 0 0 {} 0\"/>\n",
                num(f64::from(c.r)),
                num(f64::from(c.g)),
                num(f64::from(c.b)),
                num(f64::from(c.a))
            )
        };
        let offset = |v: Vec2| {
            (
                world.m00 * v.x + world.m01 * v.y,
                world.m10 * v.x + world.m11 * v.y,
            )
        };
        let mut last = "BackgroundImageFix".to_owned();
        let mut k = 0;
        for e in effects.iter().filter(|e| e.kind == EffectKind::DropShadow) {
            k += 1;
            f.push_str(HARD_ALPHA);
            if e.spread != 0.0 && self.scene.props(self.doc, i).supports_shadow_spread() {
                let _ = writeln!(
                    f,
                    "<feMorphology radius=\"{}\" operator=\"{}\" in=\"SourceAlpha\" result=\"spread{k}\"/>",
                    num(f64::from(e.spread.abs()) * scale),
                    if e.spread > 0.0 { "dilate" } else { "erode" }
                );
            }
            let (dx, dy) = offset(e.offset);
            let _ = writeln!(f, "<feOffset dx=\"{}\" dy=\"{}\"/>", num(dx), num(dy));
            if e.radius > 0.0 {
                let _ = writeln!(
                    f,
                    "<feGaussianBlur stdDeviation=\"{}\"/>",
                    num(f64::from(e.radius) * scale / 2.0)
                );
            }
            f.push_str(&color(e.color));
            let result = format!("effect{k}_dropShadow");
            let _ = writeln!(
                f,
                "<feBlend mode=\"{}\" in2=\"{last}\" result=\"{result}\"/>",
                blend_css(e.blend_mode).unwrap_or("normal")
            );
            last = result;
        }
        let _ = writeln!(
            f,
            "<feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"{last}\" result=\"shape\"/>"
        );
        last = "shape".into();
        for e in effects.iter().filter(|e| e.kind == EffectKind::InnerShadow) {
            k += 1;
            f.push_str(HARD_ALPHA);
            let (dx, dy) = offset(e.offset);
            let _ = writeln!(f, "<feOffset dx=\"{}\" dy=\"{}\"/>", num(dx), num(dy));
            if e.radius > 0.0 {
                let _ = writeln!(
                    f,
                    "<feGaussianBlur stdDeviation=\"{}\"/>",
                    num(f64::from(e.radius) * scale / 2.0)
                );
            }
            f.push_str(
                "<feComposite in2=\"hardAlpha\" operator=\"arithmetic\" k2=\"-1\" k3=\"1\"/>\n",
            );
            f.push_str(&color(e.color));
            let result = format!("effect{k}_innerShadow");
            let _ = writeln!(
                f,
                "<feBlend mode=\"{}\" in2=\"{last}\" result=\"{result}\"/>",
                blend_css(e.blend_mode).unwrap_or("normal")
            );
            last = result;
        }
        if let Some(e) = effects.iter().find(|e| e.kind == EffectKind::LayerBlur) {
            let _ = writeln!(
                f,
                "<feGaussianBlur in=\"{last}\" stdDeviation=\"{}\" result=\"effect_layerBlur\"/>",
                num(f64::from(e.radius) * scale / 2.0)
            );
        }
        f.push_str("</filter>\n");
        self.defs.push_str(&f);
        Some(id)
    }
}

mod options;

#[cfg(test)]
mod test;
