//! PDF export: layers as vector pages (one page per layer, sized to its
//! render bounds, one unit a point).
//!
//! Shapes are paths from their geometry; solid fills and strokes are PDF
//! colors, linear and radial gradients axial and radial shadings, image
//! fills image XObjects (JPEGs embedded as they are), and text its glyph
//! outlines. Layer and paint opacity become graphics state alpha, and
//! frames clip their content. What PDF cannot draw the same way (effects,
//! masks, blend modes, angular and diamond gradients, gradients with
//! varying alpha, tiled or adjusted images, translucent groups) is drawn by
//! the renderer and placed as an image, layer by layer, so the rest stays
//! vector.

use crate::document::Document;
use crate::images::ImageStore;
use crate::model::{
    Affine, BlendMode, Color, ColorStop, EffectKind, GradientKind, ImageFilters, ImageScaleMode,
    NodeType, Paint, PaintKind, Props, Rect, StrokeAlign, Vec2, WindingRule,
};
use crate::render::{self, RenderOptions};
use crate::scene::{Scene, SceneIdx};
use crate::svg::fill_shapes;
use std::collections::HashMap;
use std::fmt::Write;
use tiny_skia::{Path, PathBuilder, PathSegment, Pixmap};

/// Pixels per unit of the images that stand in for layers PDF cannot draw.
const RASTER_SCALE: f64 = 2.0;

/// A number as written in content streams: at most four decimals.
fn n(v: f64) -> String {
    let v = if v.abs() < 5e-5 || !v.is_finite() {
        0.0
    } else {
        v
    };
    let s = format!("{v:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

fn matrix(t: &Affine) -> String {
    format!(
        "{} {} {} {} {} {}",
        n(t.m00),
        n(t.m10),
        n(t.m01),
        n(t.m11),
        n(t.m02),
        n(t.m12)
    )
}

fn rgb(c: Color) -> String {
    format!(
        "{} {} {}",
        n(f64::from(c.r.clamp(0.0, 1.0))),
        n(f64::from(c.g.clamp(0.0, 1.0))),
        n(f64::from(c.b.clamp(0.0, 1.0)))
    )
}

/// Path construction operators for `path` mapped by `t`.
fn path_ops(path: &Path, t: &Affine) -> String {
    let mut out = String::new();
    let map = |q: tiny_skia::Point| t.apply(Vec2::new(f64::from(q.x), f64::from(q.y)));
    let mut current = Vec2::default();
    let mut start = Vec2::default();
    for seg in path.segments() {
        match seg {
            PathSegment::MoveTo(a) => {
                let a = map(a);
                let _ = write!(out, "{} {} m ", n(a.x), n(a.y));
                current = a;
                start = a;
            }
            PathSegment::LineTo(a) => {
                let a = map(a);
                let _ = write!(out, "{} {} l ", n(a.x), n(a.y));
                current = a;
            }
            PathSegment::QuadTo(c, a) => {
                let (c, a) = (map(c), map(a));
                let c1 = Vec2::new(
                    current.x + 2.0 / 3.0 * (c.x - current.x),
                    current.y + 2.0 / 3.0 * (c.y - current.y),
                );
                let c2 = Vec2::new(a.x + 2.0 / 3.0 * (c.x - a.x), a.y + 2.0 / 3.0 * (c.y - a.y));
                let _ = write!(
                    out,
                    "{} {} {} {} {} {} c ",
                    n(c1.x),
                    n(c1.y),
                    n(c2.x),
                    n(c2.y),
                    n(a.x),
                    n(a.y)
                );
                current = a;
            }
            PathSegment::CubicTo(c1, c2, a) => {
                let (c1, c2, a) = (map(c1), map(c2), map(a));
                let _ = write!(
                    out,
                    "{} {} {} {} {} {} c ",
                    n(c1.x),
                    n(c1.y),
                    n(c2.x),
                    n(c2.y),
                    n(a.x),
                    n(a.y)
                );
                current = a;
            }
            PathSegment::Close => {
                out.push_str("h ");
                current = start;
            }
        }
    }
    out
}

fn fill_op(rule: WindingRule) -> &'static str {
    match rule {
        WindingRule::NonZero => "f",
        WindingRule::EvenOdd => "f*",
    }
}

fn clip_op(rule: WindingRule) -> &'static str {
    match rule {
        WindingRule::NonZero => "W n",
        WindingRule::EvenOdd => "W* n",
    }
}

/// Whether every stop has the same alpha (shadings carry no alpha).
fn uniform_alpha(stops: &[ColorStop]) -> Option<f32> {
    let first = stops.first()?.color.a;
    stops
        .iter()
        .all(|s| (s.color.a - first).abs() < 1e-3)
        .then_some(first)
}

/// Whether PDF draws `paint` as Figma does.
fn vector_paint(paint: &Paint) -> bool {
    if !matches!(paint.blend_mode, BlendMode::Normal | BlendMode::PassThrough) {
        return false;
    }
    match &paint.kind {
        PaintKind::Solid(_) => true,
        PaintKind::Gradient { kind, stops, .. } => {
            matches!(kind, GradientKind::Linear | GradientKind::Radial)
                && uniform_alpha(stops).is_some()
        }
        PaintKind::Image(img) => {
            img.scale_mode != ImageScaleMode::Tile && img.filters == ImageFilters::default()
        }
        PaintKind::Pattern(_) => false,
        PaintKind::Unsupported(_) => true,
    }
}

/// The SOF component count of a JPEG.
fn jpeg_components(bytes: &[u8]) -> Option<(u8, u32, u32)> {
    let mut at = 2;
    while at + 9 < bytes.len() {
        if bytes[at] != 0xFF {
            return None;
        }
        let marker = bytes[at + 1];
        let len = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        if matches!(marker, 0xC0..=0xC2) {
            let h = u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]);
            let w = u16::from_be_bytes([bytes[at + 7], bytes[at + 8]]);
            return Some((bytes[at + 9], u32::from(w), u32::from(h)));
        }
        at += 2 + len;
    }
    None
}

/// A PDF being assembled: objects by number (from 1).
struct Pdf {
    objects: Vec<Vec<u8>>,
    /// Image fills already embedded, by hash: object and pixel size.
    images: HashMap<String, (u32, f64, f64)>,
}

impl Pdf {
    fn reserve(&mut self) -> u32 {
        self.objects.push(Vec::new());
        self.objects.len() as u32
    }

    fn set(&mut self, id: u32, body: Vec<u8>) {
        self.objects[id as usize - 1] = body;
    }

    fn add(&mut self, body: impl Into<Vec<u8>>) -> u32 {
        let id = self.reserve();
        self.set(id, body.into());
        id
    }

    fn stream(&mut self, dict: &str, data: &[u8], deflate: bool) -> u32 {
        let compressed;
        let (data, filter) = if deflate {
            compressed = miniz_oxide::deflate::compress_to_vec_zlib(data, 6);
            (compressed.as_slice(), " /Filter /FlateDecode")
        } else {
            (data, "")
        };
        let mut body =
            format!("<< {dict}{filter} /Length {} >>\nstream\n", data.len()).into_bytes();
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream");
        self.add(body)
    }

    /// An image XObject of premultiplied pixels (with a soft mask when
    /// some are translucent).
    fn pixmap(&mut self, pixmap: &Pixmap) -> u32 {
        let (w, h) = (pixmap.width(), pixmap.height());
        let mut color = Vec::with_capacity((w * h * 3) as usize);
        let mut alpha = Vec::with_capacity((w * h) as usize);
        for px in pixmap.pixels() {
            let c = px.demultiply();
            color.extend_from_slice(&[c.red(), c.green(), c.blue()]);
            alpha.push(c.alpha());
        }
        let mask = alpha.iter().any(|&a| a < 255).then(|| {
            self.stream(
                &format!(
                    "/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 8"
                ),
                &alpha,
                true,
            )
        });
        let smask = mask.map(|m| format!(" /SMask {m} 0 R")).unwrap_or_default();
        self.stream(
            &format!(
                "/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8{smask}"
            ),
            &color,
            true,
        )
    }

    /// An image fill's XObject and pixel size.
    fn image(&mut self, doc: &Document, hash: &str) -> Option<(u32, f64, f64)> {
        if let Some(&found) = self.images.get(hash) {
            return Some(found);
        }
        let bytes = doc.images.get(hash)?;
        let embedded = match jpeg_components(bytes) {
            // JPEGs go in as they are.
            Some((c @ (1 | 3), w, h)) if bytes.starts_with(&[0xFF, 0xD8]) && w > 0 && h > 0 => {
                let space = if c == 1 { "/DeviceGray" } else { "/DeviceRGB" };
                let id = self.stream(
                    &format!(
                        "/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace {space} /BitsPerComponent 8 /Filter /DCTDecode"
                    ),
                    bytes,
                    false,
                );
                (id, f64::from(w), f64::from(h))
            }
            _ => {
                let pixmap = crate::images::decode(bytes)?;
                let id = self.pixmap(&pixmap);
                (id, f64::from(pixmap.width()), f64::from(pixmap.height()))
            }
        };
        self.images.insert(hash.to_owned(), embedded);
        Some(embedded)
    }

    fn finish(mut self, catalog: u32) -> Vec<u8> {
        let info = self.add("<< /Producer (Macro) >>");
        let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
        let mut offsets = Vec::with_capacity(self.objects.len());
        for (k, body) in self.objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", k + 1).as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref = out.len();
        let _ = write!(
            Sink(&mut out),
            "xref\n0 {}\n0000000000 65535 f \n",
            self.objects.len() + 1
        );
        for o in offsets {
            let _ = writeln!(Sink(&mut out), "{o:010} 00000 n ");
        }
        let _ = write!(
            Sink(&mut out),
            "trailer\n<< /Size {} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            self.objects.len() + 1
        );
        out
    }
}

/// `write!` into bytes.
struct Sink<'a>(&'a mut Vec<u8>);

impl std::fmt::Write for Sink<'_> {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

/// One page's content and the resources it uses.
struct Page<'a> {
    doc: &'a Document,
    scene: &'a Scene,
    images: &'a mut ImageStore,
    pdf: &'a mut Pdf,
    ops: String,
    /// Graphics states by alpha (thousandths), and their names.
    alphas: Vec<(u32, u32)>,
    shadings: Vec<u32>,
    xobjects: Vec<u32>,
}

impl Page<'_> {
    fn props(&self, i: SceneIdx) -> &Props {
        self.scene.props(self.doc, i)
    }

    /// Sets the fill and stroke alpha (inside a `q … Q`).
    fn alpha(&mut self, a: f32) {
        let key = (a.clamp(0.0, 1.0) * 1000.0).round() as u32;
        if key >= 1000 {
            return;
        }
        let k = match self.alphas.iter().position(|(v, _)| *v == key) {
            Some(k) => k,
            None => {
                let a = f64::from(key) / 1000.0;
                let id = self
                    .pdf
                    .add(format!("<< /Type /ExtGState /ca {} /CA {} >>", n(a), n(a)));
                self.alphas.push((key, id));
                self.alphas.len() - 1
            }
        };
        let _ = write!(self.ops, "/A{k} gs ");
    }

    fn xobject(&mut self, id: u32) -> String {
        let k = match self.xobjects.iter().position(|&x| x == id) {
            Some(k) => k,
            None => {
                self.xobjects.push(id);
                self.xobjects.len() - 1
            }
        };
        format!("/X{k}")
    }

    /// A shading for a linear or radial gradient, in gradient space.
    fn shading(&mut self, kind: GradientKind, stops: &[ColorStop]) -> String {
        let mut sorted = stops.to_vec();
        sorted.sort_by(|a, b| a.position.total_cmp(&b.position));
        let mut points: Vec<(f64, Color)> = sorted
            .iter()
            .map(|s| (f64::from(s.position.clamp(0.0, 1.0)), s.color))
            .collect();
        if points.is_empty() {
            points.push((0.0, Color::BLACK));
        }
        if points[0].0 > 0.0 {
            points.insert(0, (0.0, points[0].1));
        }
        let last = points[points.len() - 1];
        if last.0 < 1.0 {
            points.push((1.0, last.1));
        }
        if points.len() == 1 {
            points.push((1.0, points[0].1));
        }
        let segment = |a: Color, b: Color| {
            format!(
                "<< /FunctionType 2 /Domain [0 1] /C0 [{}] /C1 [{}] /N 1 >>",
                rgb(a),
                rgb(b)
            )
        };
        let function = if points.len() == 2 {
            segment(points[0].1, points[1].1)
        } else {
            let mut functions = String::new();
            let mut bounds = String::new();
            let mut encode = String::new();
            let mut previous = 0.0f64;
            for (k, w) in points.windows(2).enumerate() {
                functions.push_str(&segment(w[0].1, w[1].1));
                encode.push_str("0 1 ");
                if k + 2 < points.len() {
                    // Bounds must increase.
                    let b = w[1].0.max(previous + 1e-4).min(1.0);
                    previous = b;
                    let _ = write!(bounds, "{} ", n(b));
                }
            }
            format!(
                "<< /FunctionType 3 /Domain [0 1] /Functions [{functions}] /Bounds [{}] /Encode [{}] >>",
                bounds.trim_end(),
                encode.trim_end()
            )
        };
        let (shading_type, coords) = if kind == GradientKind::Linear {
            (2, "0 0.5 1 0.5")
        } else {
            (3, "0.5 0.5 0 0.5 0.5 0.5")
        };
        let id = self.pdf.add(format!(
            "<< /ShadingType {shading_type} /ColorSpace /DeviceRGB /Coords [{coords}] /Function {function} /Extend [true true] >>"
        ));
        self.shadings.push(id);
        format!("/S{}", self.shadings.len() - 1)
    }

    /// Fills `path` (node space, placed by `world`) with `paint`.
    fn fill(
        &mut self,
        path: &Path,
        rule: WindingRule,
        world: &Affine,
        paint: &Paint,
        size: Vec2,
        alpha: f32,
    ) {
        let shape = path_ops(path, world);
        match &paint.kind {
            PaintKind::Solid(c) => {
                self.ops.push_str("q ");
                self.alpha(c.a * paint.opacity * alpha);
                let _ = writeln!(self.ops, "{} rg {shape}{} Q", rgb(*c), fill_op(rule));
            }
            PaintKind::Gradient {
                kind,
                stops,
                transform,
            } => {
                let Some(inv) = transform.invert() else {
                    return;
                };
                let to_node = Affine::scale(size.x.max(1e-6), size.y.max(1e-6)).mul(&inv);
                let a = uniform_alpha(stops).unwrap_or(1.0);
                let name = self.shading(*kind, stops);
                self.ops.push_str("q ");
                self.alpha(a * paint.opacity * alpha);
                let _ = writeln!(
                    self.ops,
                    "{shape}{} {} cm {name} sh Q",
                    clip_op(rule),
                    matrix(&world.mul(&to_node))
                );
            }
            PaintKind::Image(img) => {
                let placed = img
                    .hash
                    .as_deref()
                    .and_then(|h| self.pdf.image(self.doc, h));
                let Some((id, iw, ih)) = placed else {
                    // A missing image shows Figma's neutral placeholder.
                    let gray = Paint {
                        kind: PaintKind::Solid(Color {
                            r: 0.9,
                            g: 0.9,
                            b: 0.9,
                            a: 1.0,
                        }),
                        ..paint.clone()
                    };
                    self.fill(path, rule, world, &gray, size, alpha);
                    return;
                };
                let Some(to_node) = crate::render::paint::image_transform(img, iw, ih, size) else {
                    return;
                };
                // The image's unit square, top row first.
                let unit = Affine {
                    m00: iw,
                    m01: 0.0,
                    m02: 0.0,
                    m10: 0.0,
                    m11: -ih,
                    m12: ih,
                };
                let name = self.xobject(id);
                self.ops.push_str("q ");
                self.alpha(paint.opacity * alpha);
                let _ = writeln!(
                    self.ops,
                    "{shape}{} {} cm {name} Do Q",
                    clip_op(rule),
                    matrix(&world.mul(&to_node).mul(&unit))
                );
            }
            PaintKind::Pattern(_) | PaintKind::Unsupported(_) => {}
        }
    }

    /// Whether node `i` is drawn as an image rather than as vectors.
    fn needs_raster(&self, i: SceneIdx) -> bool {
        let p = self.props(i);
        let node = self.scene.node(i);
        let visible_children = p.node_type().draws_children()
            && node.children.iter().any(|&c| self.props(c).visible());
        let has_fills = p.has_visible_fills();
        let has_strokes = p.has_visible_strokes();
        let text = p.node_type().is_text();
        p.effects()
            .iter()
            .any(|e| e.is_visible() && e.kind != EffectKind::Other)
            || !matches!(p.blend_mode(), BlendMode::PassThrough | BlendMode::Normal)
            || node
                .children
                .iter()
                .any(|&c| self.props(c).is_mask() && self.props(c).visible())
            || (p.opacity() < 1.0 && (visible_children || (has_fills && has_strokes)))
            || p.fills()
                .iter()
                .chain(p.strokes())
                .any(|f| f.is_visible() && !vector_paint(f))
            || p.fill_geometry().iter().any(|g| g.style != 0)
            || p.node_type() == NodeType::TextPath
            || (text && has_strokes)
            || (text
                && p.text_layout
                    .as_ref()
                    .is_some_and(|l| l.glyphs.iter().any(|g| g.emoji.is_some())))
            || (has_strokes
                && p.stroke_geometry().is_empty()
                && p.strokes()
                    .iter()
                    .any(|s| s.is_visible() && !matches!(s.kind, PaintKind::Solid(_))))
    }

    fn node(&mut self, i: SceneIdx) {
        let p = self.props(i);
        if !p.visible() || p.opacity() <= 0.0 || p.node_type() == NodeType::Slice {
            return;
        }
        if self.needs_raster(i) {
            self.raster(i);
            return;
        }
        let alpha = p.opacity();
        let world = self.scene.node(i).world;
        let size = p.size();
        if p.node_type().is_text() {
            self.text(i, alpha);
        } else if p.has_visible_fills() {
            let fills: Vec<Paint> = p
                .fills()
                .iter()
                .filter(|f| f.is_visible())
                .cloned()
                .collect();
            let shapes = fill_shapes(self.doc, self.scene, i);
            for paint in &fills {
                for (path, rule) in &shapes {
                    self.fill(path, *rule, &world, paint, size, alpha);
                }
            }
        }
        let container_stroke =
            self.props(i).node_type().is_frame_like() && !self.props(i).clips_content();
        if container_stroke && self.props(i).has_visible_strokes() {
            self.strokes(i, alpha);
        }
        let p = self.props(i);
        let children = self.scene.node(i).children.clone();
        if p.node_type().draws_children() && !children.is_empty() {
            let clip = if p.clips_content() {
                fill_shapes(self.doc, self.scene, i)
            } else {
                Vec::new()
            };
            if !clip.is_empty() {
                self.ops.push_str("q ");
                for (path, rule) in &clip {
                    let _ = write!(self.ops, "{}{} ", path_ops(path, &world), clip_op(*rule));
                }
                self.ops.push('\n');
            }
            for c in children {
                self.node(c);
            }
            if !clip.is_empty() {
                self.ops.push_str("Q\n");
            }
        }
        if self.props(i).has_visible_strokes() && !container_stroke {
            self.strokes(i, alpha);
        }
    }

    /// The layer drawn by the renderer, placed as an image.
    fn raster(&mut self, i: SceneIdx) {
        let Some(pixmap) = render::render_node(
            self.doc,
            self.scene,
            self.images,
            i,
            RASTER_SCALE,
            RenderOptions::default(),
        ) else {
            return;
        };
        let b = self.scene.node(i).bounds;
        let w = f64::from(pixmap.width()) / RASTER_SCALE;
        let h = f64::from(pixmap.height()) / RASTER_SCALE;
        let id = self.pdf.pixmap(&pixmap);
        let name = self.xobject(id);
        let _ = writeln!(
            self.ops,
            "q {} 0 0 {} {} {} cm {name} Do Q",
            n(w),
            n(-h),
            n(b.x),
            n(b.y + h)
        );
    }

    /// Text as glyph outlines, run by run in each style's fills.
    fn text(&mut self, i: SceneIdx, alpha: f32) {
        let p = self.props(i).clone();
        let Some(layout) = p.text_layout.clone() else {
            return;
        };
        let world = self.scene.node(i).world;
        let mut runs: Vec<(u32, PathBuilder)> = Vec::new();
        for g in layout.glyphs.iter() {
            let Some(path) = g.blob.and_then(|b| self.doc.blobs.path(b)) else {
                continue;
            };
            if runs.last().is_none_or(|r| r.0 != g.style_id) {
                runs.push((g.style_id, PathBuilder::new()));
            }
            if let Some(glyph) = path.path.clone().transform(g.to_node().to_skia())
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
        let size = p.size();
        for (style, pb) in runs {
            let Some(path) = pb.finish() else { continue };
            let fills = p
                .text_content
                .as_ref()
                .and_then(|c| c.styles.iter().find(|r| r.id == style))
                .and_then(|r| r.fills.clone())
                .or_else(|| p.fills.clone())
                .unwrap_or_else(|| std::sync::Arc::from([]));
            for paint in fills.iter().filter(|f| f.is_visible()) {
                self.fill(&path, WindingRule::NonZero, &world, paint, size, alpha);
            }
        }
    }

    /// Strokes: the stored outline filled, or the shape stroked (inside
    /// and outside strokes clipped to their side of the fill).
    fn strokes(&mut self, i: SceneIdx, alpha: f32) {
        let p = self.props(i).clone();
        let world = self.scene.node(i).world;
        let size = p.size();
        let paints: Vec<Paint> = p
            .strokes()
            .iter()
            .filter(|s| s.is_visible())
            .cloned()
            .collect();
        let stored: Vec<(Path, WindingRule)> = p
            .stroke_geometry()
            .iter()
            .filter_map(|g| Some((self.doc.blobs.path(g.blob)?.path.clone(), g.winding)))
            .collect();
        if !stored.is_empty() {
            for paint in &paints {
                for (path, rule) in &stored {
                    self.fill(path, *rule, &world, paint, size, alpha);
                }
            }
            return;
        }
        if p.node_type().is_text() {
            return;
        }
        let shapes = fill_shapes(self.doc, self.scene, i);
        let lines: Vec<Path> = if p.node_type() == NodeType::Line {
            let mut pb = PathBuilder::new();
            pb.move_to(0.0, 0.0);
            pb.line_to(size.x as f32, 0.0);
            pb.finish().into_iter().collect()
        } else {
            shapes.iter().map(|s| s.0.clone()).collect()
        };
        let open = p.node_type() == NodeType::Line
            || p.node_type() == NodeType::Vector && p.fill_geometry().is_empty();
        let align = p.stroke_align();
        let width = if open || align == StrokeAlign::Center {
            p.stroke_weight()
        } else {
            p.stroke_weight() * 2.0
        };
        let mut style = format!("{} w ", n(f64::from(width)));
        match p.stroke_cap.as_deref() {
            Some("ROUND" | "ARROW_LINES" | "ARROW_EQUILATERAL") => style.push_str("1 J "),
            Some("SQUARE") => style.push_str("2 J "),
            _ => {}
        }
        match p.stroke_join.as_deref() {
            Some("ROUND") => style.push_str("1 j "),
            Some("BEVEL") => style.push_str("2 j "),
            _ => {}
        }
        if let Some(dash) = p.dash_pattern.as_deref().filter(|d| !d.is_empty()) {
            let d: Vec<String> = dash.iter().map(|v| n(f64::from(*v))).collect();
            let _ = write!(style, "[{}] 0 d ", d.join(" "));
        }
        let clipped = !open && align != StrokeAlign::Center && !shapes.is_empty();
        if clipped {
            self.ops.push_str("q ");
            if align == StrokeAlign::Outside {
                // Everything but the fill.
                let b: Rect = self.scene.node(i).bounds.outset(1.0);
                let _ = write!(self.ops, "{} {} {} {} re ", n(b.x), n(b.y), n(b.w), n(b.h));
                for (path, _) in &shapes {
                    self.ops.push_str(&path_ops(path, &world));
                }
                self.ops.push_str("W* n\n");
            } else {
                for (path, rule) in &shapes {
                    let _ = write!(self.ops, "{}{} ", path_ops(path, &world), clip_op(*rule));
                }
                self.ops.push('\n');
            }
        }
        for paint in &paints {
            let PaintKind::Solid(c) = paint.kind else {
                continue;
            };
            self.ops.push_str("q ");
            self.alpha(c.a * paint.opacity * alpha);
            let _ = write!(self.ops, "{} RG {} cm {style}", rgb(c), matrix(&world));
            for path in &lines {
                self.ops.push_str(&path_ops(path, &Affine::IDENTITY));
            }
            self.ops.push_str("S Q\n");
        }
        if clipped {
            self.ops.push_str("Q\n");
        }
    }
}

/// The layers `nodes` as a PDF, one page each; `None` when none draws.
pub fn export(
    doc: &Document,
    scene: &Scene,
    images: &mut ImageStore,
    nodes: &[SceneIdx],
) -> Option<Vec<u8>> {
    let mut pdf = Pdf {
        objects: Vec::new(),
        images: HashMap::new(),
    };
    let catalog = pdf.reserve();
    let pages = pdf.reserve();
    let mut kids = Vec::new();
    for &node in nodes {
        let bounds = scene.node(node).bounds;
        if bounds.is_empty() {
            continue;
        }
        let mut page = Page {
            doc,
            scene,
            images,
            pdf: &mut pdf,
            ops: format!(
                "1 0 0 -1 0 {} cm 1 0 0 1 {} {} cm\n",
                n(bounds.h),
                n(-bounds.x),
                n(-bounds.y)
            ),
            alphas: Vec::new(),
            shadings: Vec::new(),
            xobjects: Vec::new(),
        };
        page.node(node);
        let Page {
            ops,
            alphas,
            shadings,
            xobjects,
            ..
        } = page;
        let dict = |prefix: &str, ids: &mut dyn Iterator<Item = u32>| {
            let items: Vec<String> = ids
                .enumerate()
                .map(|(k, id)| format!("/{prefix}{k} {id} 0 R"))
                .collect();
            items.join(" ")
        };
        let resources = format!(
            "<< /ExtGState << {} >> /Shading << {} >> /XObject << {} >> >>",
            dict("A", &mut alphas.iter().map(|(_, id)| *id)),
            dict("S", &mut shadings.into_iter()),
            dict("X", &mut xobjects.into_iter())
        );
        let content = pdf.stream("", ops.as_bytes(), true);
        kids.push(pdf.add(format!(
            "<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 {} {}] /Resources {resources} /Contents {content} 0 R >>",
            n(bounds.w),
            n(bounds.h)
        )));
    }
    if kids.is_empty() {
        return None;
    }
    let refs: Vec<String> = kids.iter().map(|k| format!("{k} 0 R")).collect();
    pdf.set(
        pages,
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            refs.join(" "),
            kids.len()
        )
        .into_bytes(),
    );
    pdf.set(
        catalog,
        format!("<< /Type /Catalog /Pages {pages} 0 R >>").into_bytes(),
    );
    Some(pdf.finish(catalog))
}
