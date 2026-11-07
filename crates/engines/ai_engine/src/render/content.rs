//! Raw content: operators run through the interpreter and drawn as a PDF
//! reader draws them: clipping paths, colors in any space, shading and
//! tiling patterns, shadings, glyph outlines (Type 3 glyphs run), images,
//! transparency groups, and soft masks.

use super::canvas::{Canvas, Group};
use super::images::ImageCache;
use super::paint::dash;
use crate::color::ColorSpace;
use crate::geom::{Affine, PathData};
use crate::interp::fonts::FontCache;
use crate::interp::{
    ColorState, Descend, GState, GroupEvent, ImageEvent, Interp, PathEvent, Resources,
    ShadingEvent, ShowEvent, Sink,
};
use crate::model::{Document, LineCap, LineJoin, Source};
use crate::pdf::content::{self, Op};
use crate::pdf::{Dict, Object, Resolve};
use crate::shading::Shading;
use tiny_skia::{FillRule, FilterQuality, Mask, Pixmap, Transform};

/// Largest side of a tiling pattern's cell drawn, in pixels.
const MAX_CELL: f64 = 2048.0;
/// Deepest soft masks and pattern cells drawn inside each other.
const MAX_NESTING: usize = 4;

/// Draws a node's source: `page_to_device` maps the page space it was
/// read in to pixels.
pub fn draw_source(
    doc: &Document,
    source: &Source,
    page_to_device: &Affine,
    canvas: &mut Canvas,
    images: &mut ImageCache,
) {
    let Some(file) = &doc.file else { return };
    let mut fonts = match file.fonts.lock() {
        Ok(f) => f,
        Err(e) => e.into_inner(),
    };
    let mut gs = GState {
        ctm: source.ctm.followed_by(page_to_device),
        base: source.base.followed_by(page_to_device),
        ..GState::default()
    };
    // The state first, each run of it in its own resources.
    let mut k = 0;
    while k < source.state.len() {
        let r = source.state[k].1;
        let run: Vec<Op> = source.state[k..]
            .iter()
            .take_while(|(_, x)| *x == r)
            .map(|(o, _)| o.clone())
            .collect();
        k += run.len();
        let resources = Resources::new(&file.pdf, file.resources(r).clone());
        let mut interp = Interp::new(&file.pdf, &mut fonts);
        gs = interp.run(&run, &resources, gs, &mut NoSink);
    }
    let resources = Resources::new(&file.pdf, file.resources(source.resources).clone());
    draw_ops(
        &file.pdf,
        &mut fonts,
        &source.ops,
        &resources,
        gs,
        canvas,
        images,
        0,
    );
}

/// A sink for operators that only set state.
struct NoSink;

impl Sink for NoSink {
    fn path(&mut self, _: &PathEvent<'_>) {}
    fn show(&mut self, _: &ShowEvent<'_>) {}
    fn image(&mut self, _: &ImageEvent<'_>) {}
    fn shading(&mut self, _: &ShadingEvent<'_>) {}
}

/// Runs operators onto a canvas.
#[expect(clippy::too_many_arguments, reason = "what drawing content needs")]
fn draw_ops(
    pdf: &dyn Resolve,
    fonts: &mut FontCache,
    ops: &[Op],
    resources: &Resources<'_>,
    gs: GState,
    canvas: &mut Canvas,
    images: &mut ImageCache,
    nesting: usize,
) {
    let base = gs.clips.len();
    let mut sink = DrawSink {
        pdf,
        canvas,
        images,
        applied: vec![Vec::new()],
        clip_base: vec![base],
        groups: Vec::new(),
        nesting,
    };
    let mut interp = Interp::new(pdf, fonts);
    interp.run(ops, resources, gs, &mut sink);
    sink.finish();
}

/// Draws what the interpreter reports.
struct DrawSink<'a> {
    pdf: &'a dyn Resolve,
    canvas: &'a mut Canvas,
    images: &'a mut ImageCache,
    /// Clip serials applied to each canvas layer.
    applied: Vec<Vec<u64>>,
    /// Clips before this index are applied by the layer below (one per
    /// canvas layer).
    clip_base: Vec<usize>,
    /// Forms started: whether each pushed a canvas layer.
    groups: Vec<bool>,
    nesting: usize,
}

impl DrawSink<'_> {
    /// Applies `gs`'s clips to the top canvas layer.
    fn sync_clips(&mut self, gs: &GState) {
        let depth = self.applied.len() - 1;
        let base = self.clip_base[depth].min(gs.clips.len());
        let wanted = &gs.clips[base..];
        let applied = &mut self.applied[depth];
        let keep = applied
            .iter()
            .zip(wanted)
            .take_while(|(s, c)| **s == c.serial)
            .count();
        while applied.len() > keep {
            applied.pop();
            self.canvas.pop_clip();
        }
        for c in &wanted[keep..] {
            let path = c.path.to_skia();
            let rule = if c.even_odd {
                FillRule::EvenOdd
            } else {
                FillRule::Winding
            };
            self.canvas.push_clip(path.as_ref(), rule);
            applied.push(c.serial);
        }
    }

    fn finish(&mut self) {
        while self.canvas.group_depth() > 0 && !self.groups.is_empty() {
            if self.groups.pop() == Some(true) {
                self.end_layer();
            }
        }
        if let Some(applied) = self.applied.last_mut() {
            for _ in applied.drain(..) {
                self.canvas.pop_clip();
            }
        }
    }

    /// Starts a canvas layer (a group, or a soft-masked painting).
    fn begin_layer(
        &mut self,
        gs: &GState,
        opacity: f32,
        blend: tiny_skia::BlendMode,
        soft_mask: Option<Mask>,
    ) {
        self.sync_clips(gs);
        self.canvas.push_group(Group {
            opacity,
            blend,
            mask: soft_mask,
        });
        self.applied.push(Vec::new());
        self.clip_base.push(gs.clips.len());
    }

    fn end_layer(&mut self) {
        if let Some(applied) = self.applied.pop() {
            for _ in applied {
                self.canvas.pop_clip();
            }
        }
        self.clip_base.pop();
        self.canvas.pop_group();
    }

    /// Runs `f` on the canvas with `gs`'s clips and soft mask in effect.
    fn paint(&mut self, gs: &GState, f: impl FnOnce(&mut Self)) {
        if let Some((mask, ctm)) = &gs.soft_mask
            && self.nesting < MAX_NESTING
        {
            let soft = self.soft_mask(mask, ctm);
            self.begin_layer(gs, 1.0, tiny_skia::BlendMode::SourceOver, soft);
            f(self);
            self.end_layer();
            return;
        }
        self.sync_clips(gs);
        if self.canvas.clipped_out() {
            return;
        }
        f(self);
    }

    /// A soft mask's coverage.
    fn soft_mask(&mut self, d: &Dict, ctm: &Affine) -> Option<Mask> {
        let pdf = self.pdf;
        let luminosity = !d.is("S", "Alpha");
        let group = pdf.resolve(d.get("G")?);
        let form = group.as_stream()?;
        let (w, h) = (self.canvas.width(), self.canvas.height());
        let mut mask_canvas = Canvas::new(w, h)?;
        let group_dict = form
            .dict
            .get("Group")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_dict().cloned());
        if luminosity {
            // The backdrop (black unless `BC` says).
            let space = group_dict
                .as_ref()
                .and_then(|g| g.get("CS"))
                .and_then(|cs| ColorSpace::parse(pdf, cs, &Dict::new()).ok())
                .unwrap_or(ColorSpace::Gray);
            let bc = d
                .get("BC")
                .map(|v| pdf.resolve(v))
                .and_then(|v| v.as_numbers())
                .map(|v| v.into_iter().map(|x| x as f32).collect::<Vec<_>>());
            let [r, g, b] = match bc {
                Some(c) => space.to_rgb(&c),
                None => [0.0, 0.0, 0.0],
            };
            mask_canvas.with_target(|p, _| {
                p.fill(
                    tiny_skia::Color::from_rgba(r, g, b, 1.0).unwrap_or(tiny_skia::Color::BLACK),
                );
            });
        }
        let matrix = form
            .dict
            .get("Matrix")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .and_then(|m| Affine::from_slice(&m))
            .unwrap_or(Affine::IDENTITY);
        let form_ctm = matrix.followed_by(ctm);
        let res = match form.dict.get("Resources").map(|v| pdf.resolve(v)) {
            Some(Object::Dict(r)) => r,
            _ => Dict::new(),
        };
        let data = pdf.stream_data(form).ok()?;
        let ops = content::parse(&data);
        let mut gs = GState {
            ctm: form_ctm,
            base: form_ctm,
            ..GState::default()
        };
        if let Some(b) = form
            .dict
            .get("BBox")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .filter(|b| b.len() == 4)
        {
            gs.clips.push(crate::interp::ClipPath {
                path: PathData::rect(crate::geom::Rect::new(b[0], b[1], b[2], b[3]))
                    .transform(&form_ctm),
                even_odd: false,
                serial: u64::MAX - 1,
                form_box: true,
            });
        }
        {
            let mut fonts = FontCache::default();
            let resources = Resources::new(pdf, res);
            draw_ops(
                pdf,
                &mut fonts,
                &ops,
                &resources,
                gs,
                &mut mask_canvas,
                self.images,
                self.nesting + 1,
            );
        }
        let pixmap = mask_canvas.finish();
        let transfer = d
            .get("TR")
            .map(|v| pdf.resolve(v))
            .filter(|v| !matches!(v, Object::Name(_)))
            .and_then(|v| crate::function::Function::parse(pdf, &v).ok());
        let mut mask = Mask::new(w, h)?;
        let out = mask.data_mut();
        for (o, p) in out.iter_mut().zip(pixmap.pixels()) {
            let v = if luminosity {
                let c = p.demultiply();
                let (r, g, b) = (
                    f32::from(c.red()),
                    f32::from(c.green()),
                    f32::from(c.blue()),
                );
                (0.3 * r + 0.59 * g + 0.11 * b) / 255.0
            } else {
                f32::from(p.alpha()) / 255.0
            };
            let v = match &transfer {
                Some(f) => f.eval(&[v]).first().copied().unwrap_or(v),
                None => v,
            };
            *o = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        Some(mask)
    }

    /// Fills a device-space path with a color state.
    fn fill_with(
        &mut self,
        path: &tiny_skia::Path,
        rule: FillRule,
        cs: &ColorState,
        alpha: f32,
        gs: &GState,
        resources: &Dict,
    ) {
        if let ColorSpace::Pattern(under) = &cs.space {
            let Some(pattern) = cs.pattern.clone() else {
                return;
            };
            self.fill_pattern(
                path,
                rule,
                &pattern,
                under.as_deref(),
                cs,
                alpha,
                gs,
                resources,
            );
            return;
        }
        let [r, g, b] = cs.rgb();
        let mut paint = tiny_skia::Paint::default();
        paint.set_color(
            match tiny_skia::Color::from_rgba(
                r.clamp(0.0, 1.0),
                g.clamp(0.0, 1.0),
                b.clamp(0.0, 1.0),
                alpha.clamp(0.0, 1.0),
            ) {
                Some(c) => c,
                None => return,
            },
        );
        paint.blend_mode = gs.blend.to_skia();
        paint.anti_alias = true;
        self.canvas.fill_path(path, &paint, rule);
    }

    /// Fills a device-space path with a pattern.
    #[expect(clippy::too_many_arguments, reason = "a pattern fill's inputs")]
    fn fill_pattern(
        &mut self,
        path: &tiny_skia::Path,
        rule: FillRule,
        pattern: &Object,
        under: Option<&ColorSpace>,
        cs: &ColorState,
        alpha: f32,
        gs: &GState,
        resources: &Dict,
    ) {
        let pdf = self.pdf;
        let dict = match pattern {
            Object::Dict(d) => d.clone(),
            Object::Stream(s) => s.dict.clone(),
            _ => return,
        };
        let matrix = dict
            .get("Matrix")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .and_then(|m| Affine::from_slice(&m))
            .unwrap_or(Affine::IDENTITY);
        let to_device = matrix.followed_by(&gs.base);
        match dict.i64("PatternType") {
            Some(2) => {
                let Some(sh) = dict.get("Shading") else {
                    return;
                };
                let Ok(shading) = Shading::parse(pdf, sh, resources) else {
                    return;
                };
                let Some(mut mask) = Mask::new(self.canvas.width(), self.canvas.height()) else {
                    return;
                };
                mask.fill_path(path, rule, true, Transform::identity());
                if let Some(clip) = self.canvas.clip() {
                    for (m, c) in mask.data_mut().iter_mut().zip(clip.data()) {
                        *m = ((u16::from(*m) * u16::from(*c) + 127) / 255) as u8;
                    }
                }
                let blend = gs.blend;
                let layered = blend != crate::model::BlendMode::Normal;
                if layered {
                    self.canvas.push_group(Group {
                        opacity: 1.0,
                        blend: blend.to_skia(),
                        mask: None,
                    });
                }
                self.canvas
                    .with_target(|p, _| shading.paint(p, to_device.to_skia(), Some(&mask), alpha));
                if layered {
                    self.canvas.pop_group();
                }
            }
            Some(1) => {
                if self.nesting >= MAX_NESTING {
                    return;
                }
                let Object::Stream(stream) = pattern else {
                    return;
                };
                let Some(cell) = self.pattern_cell(stream, &to_device, under, cs) else {
                    return;
                };
                let (pixmap, cell_to_device) = cell;
                let shader = tiny_skia::Pattern::new(
                    pixmap.as_ref(),
                    tiny_skia::SpreadMode::Repeat,
                    FilterQuality::Bilinear,
                    alpha,
                    cell_to_device.to_skia(),
                );
                let paint = tiny_skia::Paint {
                    shader,
                    blend_mode: gs.blend.to_skia(),
                    anti_alias: true,
                    force_hq_pipeline: false,
                };
                self.canvas.fill_path(path, &paint, rule);
            }
            _ => {}
        }
    }

    /// A tiling pattern's cell drawn at device resolution, and the map
    /// from its pixels to device pixels.
    fn pattern_cell(
        &mut self,
        stream: &crate::pdf::Stream,
        to_device: &Affine,
        under: Option<&ColorSpace>,
        cs: &ColorState,
    ) -> Option<(Pixmap, Affine)> {
        let pdf = self.pdf;
        let d = &stream.dict;
        let num = |k: &str| d.get(k).map(|v| pdf.resolve(v)).and_then(|v| v.as_f64());
        let bbox = d
            .get("BBox")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_numbers())
            .filter(|b| b.len() == 4)?;
        let (xstep, ystep) = (num("XStep")?.abs(), num("YStep")?.abs());
        if xstep < 1e-6 || ystep < 1e-6 {
            return None;
        }
        let scale = to_device.scale_factor().max(1e-6);
        let (cw, ch) = ((xstep * scale).ceil(), (ystep * scale).ceil());
        let shrink = (MAX_CELL / cw.max(ch)).min(1.0);
        let (pw, ph) = ((cw * shrink).max(1.0) as u32, (ch * shrink).max(1.0) as u32);
        // Pattern space to the tile's pixels: one step across and down from
        // the box's corner, y down.
        let (x0, y0) = (bbox[0].min(bbox[2]), bbox[1].min(bbox[3]));
        let (x1, y1) = (bbox[0].max(bbox[2]), bbox[1].max(bbox[3]));
        let sx = f64::from(pw) / xstep;
        let sy = f64::from(ph) / ystep;
        let to_cell = Affine([sx, 0.0, 0.0, -sy, -x0 * sx, (y0 + ystep) * sy]);
        let mut cell = Canvas::new(pw, ph)?;
        let res = match d.get("Resources").map(|v| pdf.resolve(v)) {
            Some(Object::Dict(r)) => r,
            _ => Dict::new(),
        };
        let data = pdf.stream_data(stream).ok()?;
        let ops = content::parse(&data);
        let mut color = None;
        if d.i64("PaintType") == Some(2)
            && let Some(space) = under
        {
            // Uncolored: the cell paints the color given with the pattern.
            color = Some(ColorState {
                space: space.clone(),
                comps: cs.comps.clone(),
                pattern: None,
                ops: Vec::new(),
            });
        }
        // Content past the step spills into the neighboring tiles.
        let spill_x = x1 - x0 > xstep + 1e-6;
        let spill_y = y1 - y0 > ystep + 1e-6;
        let range = |spill: bool| if spill { -1..=1 } else { 0..=0 };
        let mut fonts = FontCache::default();
        let resources = Resources::new(pdf, res);
        for dy in range(spill_y) {
            for dx in range(spill_x) {
                let at = Affine::translate(f64::from(dx) * xstep, f64::from(dy) * ystep)
                    .followed_by(&to_cell);
                let mut gs = GState {
                    ctm: at,
                    base: at,
                    ..GState::default()
                };
                if let Some(c) = &color {
                    gs.fill = c.clone();
                    gs.stroke = c.clone();
                }
                gs.clips.push(crate::interp::ClipPath {
                    path: PathData::rect(crate::geom::Rect::new(x0, y0, x1, y1)).transform(&at),
                    even_odd: false,
                    serial: u64::MAX - 2,
                    form_box: true,
                });
                draw_ops(
                    pdf,
                    &mut fonts,
                    &ops,
                    &resources,
                    gs,
                    &mut cell,
                    self.images,
                    self.nesting + 1,
                );
            }
        }
        let pixmap = cell.finish();
        let cell_to_device = to_cell.invert()?.followed_by(to_device);
        Some((pixmap, cell_to_device))
    }
}

/// A tiny-skia stroke for the graphics state (in user space).
fn stroke_of(gs: &GState) -> tiny_skia::Stroke {
    let scale = gs.ctm.scale_factor().max(1e-9);
    let width = if gs.line_width * scale < 1.0 {
        1.0 / scale
    } else {
        gs.line_width
    };
    tiny_skia::Stroke {
        width: width as f32,
        miter_limit: gs.miter.max(1.0) as f32,
        line_cap: match gs.cap {
            LineCap::Butt => tiny_skia::LineCap::Butt,
            LineCap::Round => tiny_skia::LineCap::Round,
            LineCap::Square => tiny_skia::LineCap::Square,
        },
        line_join: match gs.join {
            LineJoin::Miter => tiny_skia::LineJoin::Miter,
            LineJoin::Round => tiny_skia::LineJoin::Round,
            LineJoin::Bevel => tiny_skia::LineJoin::Bevel,
        },
        dash: dash(&gs.dash, gs.dash_offset),
    }
}

/// A user-space path stroked, as a device-space outline.
fn stroke_outline(path: &PathData, gs: &GState) -> Option<tiny_skia::Path> {
    let user = path.to_skia()?;
    let stroke = stroke_of(gs);
    let res = gs.ctm.scale_factor().max(1e-6) as f32;
    let outline = user.stroke(&stroke, res)?;
    outline.transform(gs.ctm.to_skia())
}

impl Sink for DrawSink<'_> {
    fn path(&mut self, e: &PathEvent<'_>) {
        let gs = e.gs;
        self.paint(gs, |s| {
            if e.fill
                && let Some(device) = e.path.transform(&gs.ctm).to_skia()
            {
                let rule = if e.even_odd {
                    FillRule::EvenOdd
                } else {
                    FillRule::Winding
                };
                s.fill_with(
                    &device,
                    rule,
                    &gs.fill,
                    gs.fill_alpha,
                    gs,
                    e.resources.dict(),
                );
            }
            if e.stroke
                && let Some(outline) = stroke_outline(e.path, gs)
            {
                s.fill_with(
                    &outline,
                    FillRule::Winding,
                    &gs.stroke,
                    gs.stroke_alpha,
                    gs,
                    e.resources.dict(),
                );
            }
        });
    }

    fn show(&mut self, e: &ShowEvent<'_>) {
        let gs = e.gs;
        let render = gs.text.render;
        let fills = matches!(render, 0 | 2 | 4 | 6);
        let strokes = matches!(render, 1 | 2 | 5 | 6);
        if !fills && !strokes {
            return;
        }
        let Some(inv_ctm) = gs.ctm.invert() else {
            return;
        };
        // The glyphs in user space (for stroking) and device space.
        let mut user = PathData::default();
        for g in &e.glyphs {
            if let Some(outline) = e.font.font.outline(g.code) {
                let m = g.trm.followed_by(&inv_ctm);
                user.segs
                    .extend(PathData::from_skia(&outline).transform(&m).segs);
            }
        }
        if user.is_empty() {
            return;
        }
        self.paint(gs, |s| {
            if fills && let Some(device) = user.transform(&gs.ctm).to_skia() {
                s.fill_with(
                    &device,
                    FillRule::Winding,
                    &gs.fill,
                    gs.fill_alpha,
                    gs,
                    e.resources.dict(),
                );
            }
            if strokes && let Some(outline) = stroke_outline(&user, gs) {
                s.fill_with(
                    &outline,
                    FillRule::Winding,
                    &gs.stroke,
                    gs.stroke_alpha,
                    gs,
                    e.resources.dict(),
                );
            }
        });
    }

    fn image(&mut self, e: &ImageEvent<'_>) {
        let pdf = self.pdf;
        let stencil = e
            .stream
            .dict
            .get("ImageMask")
            .or_else(|| e.stream.dict.get("IM"))
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let gs = e.gs;
        let fill = if stencil {
            let [r, g, b] = gs.fill.rgb();
            [r, g, b, 1.0]
        } else {
            [0.0, 0.0, 0.0, 1.0]
        };
        let px_w = e.ctm.apply_vector(crate::geom::Point::new(1.0, 0.0));
        let px_h = e.ctm.apply_vector(crate::geom::Point::new(0.0, 1.0));
        let shown = (px_w.x.hypot(px_w.y), px_h.x.hypot(px_h.y));
        let key = (!stencil && !e.key.starts_with("inline:")).then_some(e.key.as_str());
        let Some(pixmap) =
            self.images
                .get_stream(pdf, key, e.stream, e.resources.dict(), fill, shown)
        else {
            return;
        };
        let (w, h) = (f64::from(pixmap.width()), f64::from(pixmap.height()));
        let m = Affine([1.0 / w, 0.0, 0.0, -1.0 / h, 0.0, 1.0]).followed_by(&e.ctm);
        let interpolate = shown.0 > w * 1.5 || shown.1 > h * 1.5;
        let quality = if interpolate || shown.0 < w {
            FilterQuality::Bilinear
        } else {
            FilterQuality::Nearest
        };
        self.paint(gs, |s| {
            s.canvas.draw_pixmap(
                Pixmap::as_ref(&pixmap),
                m.to_skia(),
                gs.fill_alpha,
                gs.blend.to_skia(),
                quality,
            );
        });
    }

    fn shading(&mut self, e: &ShadingEvent<'_>) {
        let Ok(shading) = Shading::parse(self.pdf, &e.shading, e.resources.dict()) else {
            return;
        };
        let gs = e.gs;
        let ctm = gs.ctm;
        let alpha = gs.fill_alpha;
        let blend = gs.blend;
        self.paint(gs, |s| {
            let layered = blend != crate::model::BlendMode::Normal;
            if layered {
                s.canvas.push_group(Group {
                    opacity: 1.0,
                    blend: blend.to_skia(),
                    mask: None,
                });
            }
            s.canvas
                .with_target(|p, clip| shading.paint(p, ctm.to_skia(), clip, alpha));
            if layered {
                s.canvas.pop_group();
            }
        });
    }

    fn begin_group(&mut self, e: &GroupEvent<'_>) -> Descend {
        let gs = e.gs;
        let transparency = e.group.as_ref().is_some_and(|g| g.is("S", "Transparency"));
        let layered = transparency
            && (gs.fill_alpha < 1.0
                || gs.blend != crate::model::BlendMode::Normal
                || gs.soft_mask.is_some());
        if layered {
            let soft = match &gs.soft_mask {
                Some((mask, ctm)) if self.nesting < MAX_NESTING => self.soft_mask(mask, ctm),
                _ => None,
            };
            self.begin_layer(gs, gs.fill_alpha, gs.blend.to_skia(), soft);
        }
        self.groups.push(layered);
        Descend::Into
    }

    fn end_group(&mut self) {
        if self.groups.pop() == Some(true) {
            self.end_layer();
        }
    }

    fn wants_type3_glyphs(&self) -> bool {
        true
    }
}
