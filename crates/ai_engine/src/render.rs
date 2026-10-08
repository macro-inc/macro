//! Drawing a document into pixels: a view of the canvas at a scale, with
//! artboards, layers, groups (clips, opacity, blend modes), paths with
//! solid and gradient paints, text (as the file placed it, or laid out
//! again), images, and raw content (run through the interpreter).

pub mod canvas;
mod content;
mod images;
mod paint;

use crate::build::node_bounds;
use crate::geom::{Affine, PathData, Rect};
use crate::model::{Document, ImageSource, Node, NodeIdx, NodeKind, Paint, PathNode, TextNode};
use canvas::{Canvas, Group};
use images::ImageCache;
use tiny_skia::{FillRule, FilterQuality, Transform};

/// The part of the canvas drawn and its size in pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    /// Canvas x of the left edge.
    pub x: f64,
    /// Canvas y of the top edge.
    pub y: f64,
    /// Pixels per canvas unit.
    pub scale: f64,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

impl View {
    /// Canvas to pixels.
    pub fn transform(&self) -> Affine {
        Affine::translate(-self.x, -self.y).followed_by(&Affine::scale(self.scale, self.scale))
    }

    /// The canvas rectangle shown.
    pub fn rect(&self) -> Rect {
        Rect::from_xywh(
            self.x,
            self.y,
            f64::from(self.width) / self.scale,
            f64::from(self.height) / self.scale,
        )
    }
}

/// What to draw besides the artwork.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Options {
    /// Fill artboards white.
    pub artboards: bool,
    /// Outline mode: paths as thin lines, no paint.
    pub outline: bool,
}

/// Draws documents; keeps decoded images between draws.
#[derive(Default)]
pub struct Renderer {
    images: ImageCache,
}

/// What a draw needs besides the canvas.
struct Ctx<'a> {
    doc: &'a Document,
    /// Canvas to pixels.
    view: Affine,
    /// The canvas rectangle shown (with a margin).
    visible: Rect,
    /// Pixels per canvas unit.
    scale: f64,
    outline: bool,
}

impl Renderer {
    /// A renderer.
    pub fn new() -> Renderer {
        Renderer::default()
    }

    /// Draws the canvas in a view; straight RGBA.
    pub fn render(&mut self, doc: &Document, view: &View, options: &Options) -> Vec<u8> {
        canvas::unpremultiply(&self.render_pixmap(doc, view, options))
    }

    /// Draws the canvas in a view, premultiplied.
    pub fn render_pixmap(
        &mut self,
        doc: &Document,
        view: &View,
        options: &Options,
    ) -> tiny_skia::Pixmap {
        let Some(mut canvas) = Canvas::new(view.width.max(1), view.height.max(1)) else {
            return tiny_skia::Pixmap::new(1, 1).expect("1×1");
        };
        let ctx = Ctx {
            doc,
            view: view.transform(),
            visible: view.rect().outset(2.0 / view.scale.max(1e-9)),
            scale: view.scale,
            outline: options.outline,
        };
        if options.artboards {
            let mut paint = tiny_skia::Paint::default();
            paint.set_color_rgba8(255, 255, 255, 255);
            for a in doc.artboards.iter().filter(|a| !a.removed) {
                if let Some(r) = a.rect.transform(&ctx.view).to_skia() {
                    let path = tiny_skia::PathBuilder::from_rect(r);
                    canvas.fill_path(&path, &paint, FillRule::Winding);
                }
            }
        }
        for &l in &doc.layers {
            self.draw(&ctx, &mut canvas, l);
        }
        canvas.finish()
    }

    /// Draws one node (and what it holds) alone, in a view.
    pub fn render_node(&mut self, doc: &Document, i: NodeIdx, view: &View) -> Vec<u8> {
        let Some(mut canvas) = Canvas::new(view.width.max(1), view.height.max(1)) else {
            return Vec::new();
        };
        let ctx = Ctx {
            doc,
            view: view.transform(),
            visible: view.rect(),
            scale: view.scale,
            outline: false,
        };
        self.draw(&ctx, &mut canvas, i);
        canvas::unpremultiply(&canvas.finish())
    }

    /// Forgets decoded images.
    pub fn clear(&mut self) {
        self.images.clear();
    }

    fn draw(&mut self, ctx: &Ctx<'_>, canvas: &mut Canvas, i: NodeIdx) {
        let n = ctx.doc.node(i);
        if n.removed || n.hidden || n.opacity <= 0.0 {
            return;
        }
        if !n.is_container()
            && let Some(b) = node_bounds(ctx.doc, i)
            && !b.intersects(&ctx.visible)
        {
            return;
        }
        match &n.kind {
            NodeKind::Layer { .. } => {
                for &c in &n.children {
                    self.draw(ctx, canvas, c);
                }
            }
            NodeKind::Group { clip, .. } => {
                if let Some(b) = node_bounds(ctx.doc, i)
                    && !b.intersects(&ctx.visible)
                {
                    return;
                }
                let layered =
                    !ctx.outline && (n.opacity < 1.0 || n.blend != crate::model::BlendMode::Normal);
                if let Some(c) = clip
                    && !ctx.outline
                {
                    let path = c.path.transform(&ctx.view).to_skia();
                    let rule = if c.even_odd {
                        FillRule::EvenOdd
                    } else {
                        FillRule::Winding
                    };
                    canvas.push_clip(path.as_ref(), rule);
                }
                if layered {
                    canvas.push_group(Group {
                        opacity: n.opacity,
                        blend: n.blend.to_skia(),
                        mask: None,
                    });
                }
                if !canvas.clipped_out() {
                    for &c in &n.children {
                        self.draw(ctx, canvas, c);
                    }
                }
                if layered {
                    canvas.pop_group();
                }
                if clip.is_some() && !ctx.outline {
                    canvas.pop_clip();
                }
            }
            NodeKind::Path(p) => draw_path(ctx, canvas, n, p),
            NodeKind::Text(t) => self.draw_text(ctx, canvas, n, t),
            NodeKind::Image(img) => {
                self.draw_image(ctx, canvas, n, &img.source, img.width, img.height)
            }
            NodeKind::Raw { bounds } => {
                if ctx.outline {
                    if let Some(b) = node_bounds(ctx.doc, i) {
                        outline_box(ctx, canvas, b);
                    }
                    return;
                }
                if let Some(source) = &n.source {
                    let delta = source
                        .transform
                        .invert()
                        .map(|inv| inv.followed_by(&n.transform))
                        .unwrap_or(Affine::IDENTITY);
                    // Page space (as read) to pixels.
                    let page_to_device =
                        source.transform.followed_by(&delta).followed_by(&ctx.view);
                    // A shading fills all the clip leaves it, and the page's
                    // own clip is dropped on reading (artwork past the
                    // artboard shows): it stays in the area it was read with.
                    let shading = source.ops.iter().any(|o| o.is("sh"));
                    if shading {
                        let area = PathData::rect(*bounds)
                            .transform(&delta)
                            .transform(&ctx.view)
                            .to_skia();
                        canvas.push_clip(area.as_ref(), FillRule::Winding);
                    }
                    let layered = n.opacity < 1.0 || n.blend != crate::model::BlendMode::Normal;
                    if layered {
                        canvas.push_group(Group {
                            opacity: n.opacity,
                            blend: n.blend.to_skia(),
                            mask: None,
                        });
                    }
                    content::draw_source(
                        ctx.doc,
                        source,
                        &page_to_device,
                        canvas,
                        &mut self.images,
                    );
                    if layered {
                        canvas.pop_group();
                    }
                    if shading {
                        canvas.pop_clip();
                    }
                }
            }
        }
    }

    fn draw_text(&mut self, ctx: &Ctx<'_>, canvas: &mut Canvas, n: &Node, t: &TextNode) {
        let to_device = n.transform.followed_by(&ctx.view);
        if let Some(runs) = &t.runs {
            let Some(file) = &ctx.doc.file else { return };
            let fonts = match file.fonts.lock() {
                Ok(f) => f,
                Err(e) => e.into_inner(),
            };
            for run in runs {
                let Some(font) = fonts.get(&run.font) else {
                    continue;
                };
                for g in &run.glyphs {
                    let Some(outline) = font.font.outline(g.code) else {
                        continue;
                    };
                    let m = Affine::translate(g.x, 0.0)
                        .followed_by(&run.matrix)
                        .followed_by(&to_device);
                    if ctx.outline {
                        outline_path(canvas, &outline, &m);
                        continue;
                    }
                    if let Some(fill) = &run.fill {
                        paint::fill(
                            canvas,
                            &outline,
                            fill,
                            FillRule::Winding,
                            n.opacity,
                            n.blend,
                            &m,
                            &to_device,
                        );
                    }
                    if let Some(stroke) = &run.stroke {
                        paint::stroke(canvas, &outline, stroke, n.opacity, n.blend, &m);
                    }
                }
            }
            return;
        }
        let outlines = crate::text::outlines(t);
        let Some(path) = outlines.to_skia() else {
            return;
        };
        if ctx.outline {
            outline_path(canvas, &path, &to_device);
            return;
        }
        if let Some(fill) = &t.fill {
            paint::fill(
                canvas,
                &path,
                fill,
                FillRule::Winding,
                n.opacity,
                n.blend,
                &to_device,
                &to_device,
            );
        }
        if let Some(stroke) = &t.stroke {
            paint::stroke(canvas, &path, stroke, n.opacity, n.blend, &to_device);
        }
    }

    fn draw_image(
        &mut self,
        ctx: &Ctx<'_>,
        canvas: &mut Canvas,
        n: &Node,
        source: &ImageSource,
        width: u32,
        height: u32,
    ) {
        let to_device = n.transform.followed_by(&ctx.view);
        if ctx.outline {
            outline_box(
                ctx,
                canvas,
                Rect::new(0.0, 0.0, 1.0, 1.0).transform(&n.transform),
            );
            return;
        }
        // Samples per pixel along each axis.
        let px_w = to_device.apply_vector(crate::geom::Point::new(1.0, 0.0));
        let px_h = to_device.apply_vector(crate::geom::Point::new(0.0, 1.0));
        let shown = (px_w.x.hypot(px_w.y), px_h.x.hypot(px_h.y));
        let Some(image) = self.images.get(ctx.doc, n, source, shown) else {
            return;
        };
        let (w, h) = (f64::from(image.width()), f64::from(image.height()));
        let _ = (width, height);
        // Image rows run top down; the unit square's y runs up.
        let m = Affine([1.0 / w, 0.0, 0.0, -1.0 / h, 0.0, 1.0]).followed_by(&to_device);
        let quality = if shown.0 * 1.5 < w || shown.1 * 1.5 < h || shown.0 > w * 1.5 {
            FilterQuality::Bilinear
        } else {
            FilterQuality::Bicubic
        };
        canvas.draw_pixmap(
            tiny_skia::Pixmap::as_ref(&image),
            m.to_skia(),
            n.opacity,
            n.blend.to_skia(),
            quality,
        );
        let _ = ctx.scale;
    }
}

/// Fills and strokes a path node.
fn draw_path(ctx: &Ctx<'_>, canvas: &mut Canvas, n: &Node, p: &PathNode) {
    let Some(path) = p.data.to_skia() else { return };
    let m = n.transform.followed_by(&ctx.view);
    if ctx.outline {
        outline_path(canvas, &path, &m);
        return;
    }
    let rule = if p.even_odd {
        FillRule::EvenOdd
    } else {
        FillRule::Winding
    };
    if let Some(fill) = &p.fill {
        paint::fill(canvas, &path, fill, rule, n.opacity, n.blend, &m, &m);
    }
    if let Some(stroke) = &p.stroke {
        paint::stroke(canvas, &path, stroke, n.opacity, n.blend, &m);
    }
}

/// A path drawn as a thin dark line (outline mode).
fn outline_path(canvas: &mut Canvas, path: &tiny_skia::Path, m: &Affine) {
    let Some(device) = path.clone().transform(m.to_skia()) else {
        return;
    };
    let mut paint = tiny_skia::Paint::default();
    paint.set_color_rgba8(30, 30, 30, 255);
    paint.anti_alias = true;
    let stroke = tiny_skia::Stroke {
        width: 1.0,
        ..Default::default()
    };
    canvas.stroke_path(&device, &paint, &stroke, Transform::identity());
}

/// A box with a cross (outline mode for images and raw content).
fn outline_box(ctx: &Ctx<'_>, canvas: &mut Canvas, r: Rect) {
    let mut pb = tiny_skia::PathBuilder::new();
    pb.move_to(r.x0 as f32, r.y0 as f32);
    pb.line_to(r.x1 as f32, r.y0 as f32);
    pb.line_to(r.x1 as f32, r.y1 as f32);
    pb.line_to(r.x0 as f32, r.y1 as f32);
    pb.close();
    pb.move_to(r.x0 as f32, r.y0 as f32);
    pb.line_to(r.x1 as f32, r.y1 as f32);
    pb.move_to(r.x1 as f32, r.y0 as f32);
    pb.line_to(r.x0 as f32, r.y1 as f32);
    if let Some(path) = pb.finish() {
        outline_path(canvas, &path, &ctx.view);
    }
}

/// Whether a paint is fully transparent.
pub fn invisible(p: &Paint) -> bool {
    match p {
        Paint::Solid { .. } => false,
        Paint::Gradient { gradient } => gradient.stops.iter().all(|s| s.opacity <= 0.0),
    }
}

#[cfg(test)]
mod test;
