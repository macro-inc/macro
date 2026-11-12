//! The GDI device-context model shared by the EMF and WMF players: drawing
//! state, the object table, coordinate transforms, clipping, path brackets,
//! and node output in device space.

use super::objects::{
    Brush, DEFAULT_PALETTE, Object, PS_ALTERNATE, PS_ENDCAP_FLAT, PS_ENDCAP_MASK, PS_ENDCAP_SQUARE,
    PS_INSIDEFRAME, PS_JOIN_BEVEL, PS_JOIN_MASK, PS_JOIN_MITER, PS_NULL, PS_STYLE_MASK,
    PS_USERSTYLE, Pen,
};
use super::output::Output;
use super::region::{Clip, RGN_COPY, Shape};
use super::text::LogFont;
use crate::font::FontDb;
use crate::model::color::Rgba;
use crate::path::{Affine, Path, PathEl, Point, Rect};
use crate::render::scene::{LineCap, LineJoin, Node, Paint, Stroke};
use std::sync::Arc;

/// `MM_TEXT`: one logical unit is one device pixel.
pub(super) const MM_TEXT: u32 = 1;
/// `MM_LOMETRIC`: 0.1 mm, y up.
pub(super) const MM_LOMETRIC: u32 = 2;
/// `MM_HIMETRIC`: 0.01 mm, y up.
pub(super) const MM_HIMETRIC: u32 = 3;
/// `MM_LOENGLISH`: 0.01 inch, y up.
pub(super) const MM_LOENGLISH: u32 = 4;
/// `MM_HIENGLISH`: 0.001 inch, y up.
pub(super) const MM_HIENGLISH: u32 = 5;
/// `MM_TWIPS`: 1/1440 inch, y up.
pub(super) const MM_TWIPS: u32 = 6;
/// `MM_ISOTROPIC`: window/viewport mapping with equal x and y units.
pub(super) const MM_ISOTROPIC: u32 = 7;
/// `MM_ANISOTROPIC`: free window/viewport mapping.
pub(super) const MM_ANISOTROPIC: u32 = 8;

/// `ALTERNATE` polygon fill mode (even-odd).
pub(super) const ALTERNATE: u32 = 1;
/// `OPAQUE` background mode.
pub(super) const OPAQUE: u32 = 2;

const R2_BLACK: u32 = 1;
const R2_NOTCOPYPEN: u32 = 4;
const R2_NOT: u32 = 6;
const R2_XORPEN: u32 = 7;
const R2_MASKPEN: u32 = 9;
const R2_NOP: u32 = 11;
/// `R2_COPYPEN`: the default mix mode.
pub(super) const R2_COPYPEN: u32 = 13;
const R2_MERGEPEN: u32 = 15;
const R2_WHITE: u32 = 16;

/// Records processed per file at most.
pub(super) const MAX_RECORDS: usize = 1_000_000;
/// Object-table slots at most.
pub(super) const MAX_OBJECTS: usize = 65_536;
const MAX_SAVED: usize = 4096;
const MAX_NODES: usize = 250_000;
const MAX_PATH_ELS: usize = 4_000_000;

/// The reference device the metafile is played on.
#[derive(Clone, Copy, Debug)]
pub(super) struct Device {
    /// Device size in pixels (for the metric mapping modes).
    pub(super) size_px: (f64, f64),
    /// Device size in millimetres.
    pub(super) size_mm: (f64, f64),
    /// One screen pixel (1/96 inch) in device units: the thinnest geometric
    /// line, the unit of cosmetic dashes, and the size of pattern pixels.
    pub(super) px: f64,
    /// Device-space bounds standing in for "everything" in region math.
    pub(super) universe: Rect,
    /// WMF: the window always maps onto the fixed viewport (the picture).
    pub(super) wmf: bool,
}

/// The device context: everything `SaveDC` saves.
#[derive(Clone, Debug)]
pub(super) struct Dc {
    /// `MM_*` mapping mode.
    pub(super) map_mode: u32,
    /// Window origin (logical units).
    pub(super) win_org: (f64, f64),
    /// Window extent (logical units, never zero).
    pub(super) win_ext: (f64, f64),
    /// Viewport origin (device units).
    pub(super) vp_org: (f64, f64),
    /// Viewport extent (device units, never zero).
    pub(super) vp_ext: (f64, f64),
    /// World → page transform.
    pub(super) world: Affine,
    /// Selected pen.
    pub(super) pen: Pen,
    /// Selected brush.
    pub(super) brush: Brush,
    /// Selected font.
    pub(super) font: LogFont,
    /// Selected palette (`None` = default).
    pub(super) palette: Option<Arc<Vec<[u8; 3]>>>,
    /// Text color.
    pub(super) text_color: Rgba,
    /// Background color.
    pub(super) bk_color: Rgba,
    /// `TRANSPARENT` or `OPAQUE`.
    pub(super) bk_mode: u32,
    /// `ALTERNATE` or `WINDING`.
    pub(super) poly_fill: u32,
    /// `TA_*` text alignment.
    pub(super) text_align: u32,
    /// `R2_*` mix mode.
    pub(super) rop2: u32,
    /// `AD_CLOCKWISE` arcs.
    pub(super) arc_clockwise: bool,
    /// Miter limit for geometric pens.
    pub(super) miter_limit: f32,
    /// Current position (logical units).
    pub(super) cur: (f64, f64),
    /// Clip region.
    pub(super) clip: Clip,
    /// Meta region (`SETMETARGN`), applied on top of the clip region.
    pub(super) meta: Clip,
    /// Brush origin (device units).
    pub(super) brush_org: (f64, f64),
}

impl Dc {
    fn new() -> Self {
        Self {
            map_mode: MM_TEXT,
            win_org: (0.0, 0.0),
            win_ext: (1.0, 1.0),
            vp_org: (0.0, 0.0),
            vp_ext: (1.0, 1.0),
            world: Affine::IDENTITY,
            pen: Pen::solid(Rgba::BLACK, 0.0),
            brush: Brush::Solid(Rgba::WHITE),
            font: LogFont::stock("Arial", -16, 700),
            palette: None,
            text_color: Rgba::BLACK,
            bk_color: Rgba::WHITE,
            bk_mode: OPAQUE,
            poly_fill: ALTERNATE,
            text_align: 0,
            rop2: R2_COPYPEN,
            arc_clockwise: false,
            miter_limit: 10.0,
            cur: (0.0, 0.0),
            clip: Clip::default(),
            meta: Clip::default(),
            brush_org: (0.0, 0.0),
        }
    }
}

/// Resolved stroke parameters of the current pen in device units.
pub(super) struct PenStroke {
    /// Line color.
    pub(super) color: Rgba,
    /// Stroke geometry.
    pub(super) stroke: Stroke,
    /// Color painted under dash gaps (styled cosmetic pens in `OPAQUE` mode).
    pub(super) gap: Option<Rgba>,
}

/// A path bracket being recorded (device units).
struct Bracket {
    path: Path,
    /// The next "to" operation starts a new figure at the current position.
    need_move: bool,
}

/// A finished path waiting for `FILLPATH`, `STROKEPATH`, or `SELECTCLIPPATH`.
struct DevPath {
    path: Path,
    widened: bool,
}

/// The interpreter state shared by both players.
pub(super) struct Gdi<'f> {
    /// Fonts for text.
    pub(super) fonts: &'f FontDb,
    /// The reference device.
    pub(super) dev: Device,
    /// The current device context.
    pub(super) dc: Dc,
    saved: Vec<Dc>,
    objects: Vec<Option<Object>>,
    /// No slot below this index is free (WMF slot search).
    first_free: usize,
    out: Output,
    bracket: Option<Bracket>,
    path: Option<DevPath>,
    serial: u64,
}

impl<'f> Gdi<'f> {
    /// A fresh device context on `dev`.
    pub(super) fn new(fonts: &'f FontDb, dev: Device) -> Self {
        Self {
            fonts,
            dev,
            dc: Dc::new(),
            saved: Vec::new(),
            objects: Vec::new(),
            first_free: 0,
            out: Output::default(),
            bracket: None,
            path: None,
            serial: 0,
        }
    }

    /// The nodes drawn so far (device units).
    pub(super) fn finish(mut self) -> Vec<Node> {
        self.out.flush();
        self.out.nodes
    }

    // ----- Object table -----

    /// Stores an object at an explicit index (EMF handles).
    pub(super) fn set_object(&mut self, index: u32, obj: Object) {
        let i = index as usize;
        if i >= MAX_OBJECTS {
            return;
        }
        if self.objects.len() <= i {
            self.objects.resize(i + 1, None);
        }
        self.objects[i] = Some(obj);
        self.first_free = self.first_free.min(i);
    }

    /// Stores an object in the lowest free slot (WMF).
    pub(super) fn add_object(&mut self, obj: Object) {
        let start = self.first_free.min(self.objects.len());
        match self.objects[start..].iter().position(Option::is_none) {
            Some(i) => {
                self.objects[start + i] = Some(obj);
                self.first_free = start + i + 1;
            }
            None if self.objects.len() < MAX_OBJECTS => {
                self.objects.push(Some(obj));
                self.first_free = self.objects.len();
            }
            None => self.first_free = self.objects.len(),
        }
    }

    /// The object at `index`, if any.
    pub(super) fn object(&self, index: u32) -> Option<&Object> {
        self.objects.get(index as usize).and_then(Option::as_ref)
    }

    /// Frees a slot.
    pub(super) fn delete_object(&mut self, index: u32) {
        if let Some(slot) = self.objects.get_mut(index as usize) {
            *slot = None;
            self.first_free = self.first_free.min(index as usize);
        }
    }

    /// Selects an object into the device context.
    pub(super) fn select(&mut self, obj: Object) {
        match obj {
            Object::Pen(p) => self.dc.pen = p,
            Object::Brush(b) => self.dc.brush = b,
            Object::Font(f) => self.dc.font = f,
            Object::Palette(p) => self.dc.palette = (!p.is_empty()).then_some(p),
            Object::Region(r) => {
                let shape = self.logical_rects_shape(&r);
                self.clip_combine(shape, RGN_COPY);
            }
            Object::Other => {}
        }
    }

    // ----- Saved states -----

    /// `SaveDC`.
    pub(super) fn save(&mut self) {
        if self.saved.len() < MAX_SAVED {
            self.saved.push(self.dc.clone());
        }
    }

    /// `RestoreDC`: negative = relative to the newest state, positive = absolute index.
    pub(super) fn restore(&mut self, n: i32) {
        let len = self.saved.len() as i64;
        let target = if n < 0 {
            len + i64::from(n)
        } else {
            i64::from(n) - 1
        };
        if target < 0 || target >= len {
            return;
        }
        self.saved.truncate(target as usize + 1);
        if let Some(dc) = self.saved.pop() {
            self.dc = dc;
        }
    }

    // ----- Transforms -----

    /// Page → device transform.
    pub(super) fn page(&self) -> Affine {
        let dc = &self.dc;
        let (sx, sy) = if !self.dev.wmf && dc.map_mode == MM_TEXT {
            (1.0, 1.0)
        } else {
            (dc.vp_ext.0 / dc.win_ext.0, dc.vp_ext.1 / dc.win_ext.1)
        };
        Affine {
            a: sx,
            b: 0.0,
            c: 0.0,
            d: sy,
            e: dc.vp_org.0 - dc.win_org.0 * sx,
            f: dc.vp_org.1 - dc.win_org.1 * sy,
        }
    }

    /// Logical → device transform.
    pub(super) fn xform(&self) -> Affine {
        self.page().pre_concat(&self.dc.world)
    }

    /// `SetMapMode`.
    pub(super) fn set_map_mode(&mut self, mode: u32) {
        if !(MM_TEXT..=MM_ANISOTROPIC).contains(&mode) {
            return;
        }
        self.dc.map_mode = mode;
        if self.dev.wmf {
            return;
        }
        let per_mm = match mode {
            MM_LOMETRIC | MM_ISOTROPIC => 10.0,
            MM_HIMETRIC => 100.0,
            MM_LOENGLISH => 100.0 / 25.4,
            MM_HIENGLISH => 1000.0 / 25.4,
            MM_TWIPS => 1440.0 / 25.4,
            MM_TEXT => {
                self.dc.win_ext = (1.0, 1.0);
                self.dc.vp_ext = (1.0, 1.0);
                return;
            }
            _ => return,
        };
        let (mm, px) = (self.dev.size_mm, self.dev.size_px);
        self.dc.win_ext = (mm.0 * per_mm, mm.1 * per_mm);
        self.dc.vp_ext = (px.0, -px.1);
    }

    fn extents_settable(&self) -> bool {
        self.dev.wmf || matches!(self.dc.map_mode, MM_ISOTROPIC | MM_ANISOTROPIC)
    }

    /// `SetWindowExtEx`.
    pub(super) fn set_window_ext(&mut self, x: f64, y: f64) {
        if self.extents_settable() && valid_ext(x, y) {
            self.dc.win_ext = (x, y);
            self.fix_isotropic();
        }
    }

    /// `SetViewportExtEx` (ignored for WMF, whose viewport is the picture).
    pub(super) fn set_viewport_ext(&mut self, x: f64, y: f64) {
        if !self.dev.wmf && self.extents_settable() && valid_ext(x, y) {
            self.dc.vp_ext = (x, y);
            self.fix_isotropic();
        }
    }

    /// `ScaleWindowExtEx`.
    pub(super) fn scale_window_ext(&mut self, xn: f64, xd: f64, yn: f64, yd: f64) {
        if xd != 0.0 && yd != 0.0 {
            let (x, y) = self.dc.win_ext;
            self.set_window_ext(x * xn / xd, y * yn / yd);
        }
    }

    /// `ScaleViewportExtEx`.
    pub(super) fn scale_viewport_ext(&mut self, xn: f64, xd: f64, yn: f64, yd: f64) {
        if xd != 0.0 && yd != 0.0 {
            let (x, y) = self.dc.vp_ext;
            self.set_viewport_ext(x * xn / xd, y * yn / yd);
        }
    }

    /// `SetWindowOrgEx`.
    pub(super) fn set_window_org(&mut self, x: f64, y: f64) {
        self.dc.win_org = (x, y);
    }

    /// `SetViewportOrgEx` (ignored for WMF).
    pub(super) fn set_viewport_org(&mut self, x: f64, y: f64) {
        if !self.dev.wmf {
            self.dc.vp_org = (x, y);
        }
    }

    /// Shrinks one viewport extent so logical units are square (`MM_ISOTROPIC`).
    fn fix_isotropic(&mut self) {
        if self.dc.map_mode != MM_ISOTROPIC {
            return;
        }
        let (mx, my) = if self.dev.wmf {
            (1.0, 1.0)
        } else {
            (
                self.dev.size_mm.0 / self.dev.size_px.0,
                self.dev.size_mm.1 / self.dev.size_px.1,
            )
        };
        let dc = &mut self.dc;
        let xdim = (dc.vp_ext.0 * mx / dc.win_ext.0).abs();
        let ydim = (dc.vp_ext.1 * my / dc.win_ext.1).abs();
        if !(xdim > 0.0 && ydim > 0.0 && xdim.is_finite() && ydim.is_finite()) {
            return;
        }
        if xdim > ydim {
            dc.vp_ext.0 *= ydim / xdim;
        } else {
            dc.vp_ext.1 *= xdim / ydim;
        }
    }

    /// `SetWorldTransform`.
    pub(super) fn set_world(&mut self, x: Affine) {
        if valid_affine(&x) {
            self.dc.world = x;
        }
    }

    /// `ModifyWorldTransform`.
    pub(super) fn modify_world(&mut self, x: Affine, mode: u32) {
        match mode {
            1 => self.dc.world = Affine::IDENTITY,
            2 if valid_affine(&x) => self.dc.world = self.dc.world.pre_concat(&x),
            3 if valid_affine(&x) => self.dc.world = x.pre_concat(&self.dc.world),
            4 => self.set_world(x),
            _ => {}
        }
    }

    /// Whether arcs sweep with increasing parametric angle in logical space
    /// (GDI arc directions are visual, i.e. in y-down device space).
    pub(super) fn arc_increasing(&self, t: &Affine) -> bool {
        let det = t.a * t.d - t.b * t.c;
        self.dc.arc_clockwise == (det > 0.0)
    }

    // ----- Colors -----

    /// A `COLORREF` (palette indices resolved through the selected palette).
    pub(super) fn color(&self, v: u32) -> Rgba {
        if v >> 24 == 1 {
            let i = (v & 0xFFFF) as usize;
            let c = match &self.dc.palette {
                Some(p) => p.get(i).copied(),
                None => DEFAULT_PALETTE.get(i).copied(),
            };
            let [r, g, b] = c.unwrap_or([0, 0, 0]);
            return Rgba::from_u8(r, g, b);
        }
        Rgba::from_u8(v as u8, (v >> 8) as u8, (v >> 16) as u8)
    }

    /// Entry `i` of the selected (or default) palette.
    pub(super) fn palette_entry(&self, i: usize) -> [u8; 3] {
        match &self.dc.palette {
            Some(p) => p.get(i).copied().unwrap_or([0, 0, 0]),
            None => DEFAULT_PALETTE.get(i).copied().unwrap_or([0, 0, 0]),
        }
    }

    /// `SetBkMode` (`TRANSPARENT` or `OPAQUE`; anything else is ignored).
    pub(super) fn set_bk_mode(&mut self, mode: u32) {
        if matches!(mode, 1 | 2) {
            self.dc.bk_mode = mode;
        }
    }

    /// `SetPolyFillMode` (`ALTERNATE` or `WINDING`).
    pub(super) fn set_poly_fill(&mut self, mode: u32) {
        if matches!(mode, 1 | 2) {
            self.dc.poly_fill = mode;
        }
    }

    /// `SetROP2` (`R2_BLACK`..=`R2_WHITE`).
    pub(super) fn set_rop2(&mut self, mode: u32) {
        if (R2_BLACK..=R2_WHITE).contains(&mode) {
            self.dc.rop2 = mode;
        }
    }

    /// Whether the mix mode paints at all (`R2_NOP` and `R2_NOT` do not).
    pub(super) fn paints(&self) -> bool {
        !matches!(self.dc.rop2, R2_NOP | R2_NOT)
    }

    /// The color a pen or brush actually paints under the current mix mode.
    pub(super) fn rop2(&self, c: Rgba) -> Option<Rgba> {
        let white = c.r >= 0.999 && c.g >= 0.999 && c.b >= 0.999;
        let black = c.r <= 0.001 && c.g <= 0.001 && c.b <= 0.001;
        match self.dc.rop2 {
            R2_BLACK => Some(Rgba::BLACK),
            R2_WHITE => Some(Rgba::WHITE),
            R2_NOP | R2_NOT => None,
            R2_NOTCOPYPEN => Some(Rgba {
                r: 1.0 - c.r,
                g: 1.0 - c.g,
                b: 1.0 - c.b,
                a: c.a,
            }),
            R2_MASKPEN if white => None,
            R2_MERGEPEN | R2_XORPEN if black => None,
            _ => Some(c),
        }
    }

    // ----- Pens -----

    /// The current pen's stroke under transform `t` (`None` for `PS_NULL`).
    pub(super) fn pen_stroke(&self, t: &Affine) -> Option<PenStroke> {
        let pen = &self.dc.pen;
        let kind = pen.style & PS_STYLE_MASK;
        if kind == PS_NULL {
            return None;
        }
        let color = self.rop2(pen.color)?;
        let cosmetic = pen.cosmetic || pen.width <= 0.0;
        let geometric = if cosmetic {
            0.0
        } else {
            vec_len(t, pen.width, 0.0)
        };
        // GDI never draws thinner than a pixel: lines under a screen pixel become hairlines.
        let hairline = geometric < self.dev.px;
        let width = if hairline { 0.0 } else { geometric };
        let unit = if cosmetic {
            self.dev.px
        } else {
            geometric.max(self.dev.px)
        };
        let pattern: Option<Vec<f64>> = match kind {
            1 => Some(if cosmetic {
                vec![18.0, 6.0]
            } else {
                vec![3.0, 1.0]
            }),
            2 => Some(if cosmetic {
                vec![3.0, 3.0]
            } else {
                vec![1.0, 1.0]
            }),
            3 => Some(if cosmetic {
                vec![9.0, 6.0, 3.0, 6.0]
            } else {
                vec![3.0, 1.0, 1.0, 1.0]
            }),
            4 => Some(if cosmetic {
                vec![9.0, 3.0, 3.0, 3.0, 3.0, 3.0]
            } else {
                vec![3.0, 1.0, 1.0, 1.0, 1.0, 1.0]
            }),
            PS_ALTERNATE => Some(vec![1.0, 1.0]),
            PS_USERSTYLE if !pen.dashes.is_empty() => {
                let k = if cosmetic {
                    1.0
                } else {
                    vec_len(t, 1.0, 0.0) / unit
                };
                Some(pen.dashes.iter().map(|d| d * k).collect())
            }
            _ => None,
        };
        let dash: Option<Vec<f32>> = pattern
            .map(|p| p.iter().map(|v| (v * unit) as f32).collect::<Vec<f32>>())
            .filter(|d| d.iter().all(|v| v.is_finite() && *v >= 0.0) && d.iter().any(|v| *v > 0.0));
        let cap = match pen.style & PS_ENDCAP_MASK {
            _ if hairline || dash.is_some() => LineCap::Butt,
            PS_ENDCAP_SQUARE => LineCap::Square,
            PS_ENDCAP_FLAT => LineCap::Butt,
            _ => LineCap::Round,
        };
        let join = match pen.style & PS_JOIN_MASK {
            PS_JOIN_BEVEL => LineJoin::Bevel,
            PS_JOIN_MITER => LineJoin::Miter,
            _ => LineJoin::Round,
        };
        let gap = (cosmetic && (1..=4).contains(&kind) && self.dc.bk_mode == OPAQUE)
            .then_some(self.dc.bk_color);
        Some(PenStroke {
            color,
            stroke: Stroke {
                width: width as f32,
                cap,
                join,
                miter_limit: self.dc.miter_limit.max(1.0),
                dash,
            },
            gap,
        })
    }

    /// Shrinks a bounding box for `PS_INSIDEFRAME` geometric pens.
    pub(super) fn inside_frame(&self, l: f64, t: f64, r: f64, b: f64) -> (f64, f64, f64, f64) {
        let pen = &self.dc.pen;
        if pen.style & PS_STYLE_MASK != PS_INSIDEFRAME || pen.cosmetic || pen.width <= 1.0 {
            return (l, t, r, b);
        }
        let (l, r) = (l.min(r), l.max(r));
        let (t, b) = (t.min(b), t.max(b));
        let h = (pen.width / 2.0).min((r - l) / 2.0).min((b - t) / 2.0);
        (l + h, t + h, r - h, b - h)
    }

    // ----- Drawing -----

    /// Draws a figure given in logical units: closed figures are filled and
    /// outlined, open ones only stroked. Inside a path bracket the figure is
    /// recorded instead.
    pub(super) fn figure(&mut self, logical: &Path, closed: bool) {
        let t = self.xform();
        let dev = logical.transform(&t);
        if let Some(b) = &mut self.bracket {
            if b.path.els.len() + dev.els.len() <= MAX_PATH_ELS {
                b.path.extend(&dev);
            }
            b.need_move = true;
            return;
        }
        if closed {
            self.fill_dev(&dev, self.dc.poly_fill == ALTERNATE);
        }
        self.stroke_dev(&dev, &t);
    }

    /// Continues the current figure from the current position (`LineTo`,
    /// `PolylineTo`, `PolyBezierTo`, `ArcTo`). `logical` starts with a move
    /// to the current position.
    pub(super) fn figure_to(&mut self, logical: &Path) {
        let t = self.xform();
        let dev = logical.transform(&t);
        if let Some(b) = &mut self.bracket {
            if b.path.els.len() + dev.els.len() <= MAX_PATH_ELS {
                if b.need_move || b.path.is_empty() {
                    b.path.extend(&dev);
                } else {
                    for el in dev.els.iter().skip(1) {
                        match *el {
                            PathEl::MoveTo(p) => b.path.move_to(p),
                            PathEl::LineTo(p) => b.path.line_to(p),
                            PathEl::QuadTo(c, p) => b.path.quad_to(c, p),
                            PathEl::CubicTo(c1, c2, p) => b.path.cubic_to(c1, c2, p),
                            PathEl::Close => b.path.close(),
                        }
                    }
                }
            }
            b.need_move = false;
            return;
        }
        self.stroke_dev(&dev, &t);
    }

    /// Whether a path bracket is open.
    pub(super) fn in_bracket(&self) -> bool {
        self.bracket.is_some()
    }

    /// Adds a device-space outline (text) to the open path bracket.
    pub(super) fn bracket_add(&mut self, dev: &Path) {
        if let Some(b) = &mut self.bracket {
            if b.path.els.len() + dev.els.len() <= MAX_PATH_ELS {
                b.path.extend(dev);
            }
            b.need_move = true;
        }
    }

    /// `MoveToEx`.
    pub(super) fn move_to(&mut self, x: f64, y: f64) {
        self.dc.cur = (x, y);
        if let Some(b) = &mut self.bracket {
            b.need_move = true;
        }
    }

    /// Fills a device-space path with the current brush.
    pub(super) fn fill_dev(&mut self, path: &Path, even_odd: bool) {
        if let Some(paint) = self.brush_paint() {
            self.emit(Node::Fill {
                path: path.clone(),
                paint,
                even_odd,
            });
        }
    }

    /// Fills a device-space path with a solid color.
    pub(super) fn fill_color_dev(&mut self, path: Path, color: Rgba) {
        self.emit(Node::Fill {
            path,
            paint: Paint::Solid(color),
            even_odd: false,
        });
    }

    /// `SetPixel`: one screen pixel at a logical point.
    pub(super) fn set_pixel(&mut self, x: f64, y: f64, color: Rgba) {
        if self.in_bracket() {
            return;
        }
        let p = self.xform().apply(Point::new(x as f32, y as f32));
        let s = self.dev.px as f32;
        self.fill_color_dev(Path::rect(Rect::from_xywh(p.x, p.y, s, s)), color);
    }

    /// Strokes a device-space path with the current pen (`t` scales the pen width).
    pub(super) fn stroke_dev(&mut self, path: &Path, t: &Affine) {
        let Some(ps) = self.pen_stroke(t) else { return };
        if let Some(gap) = ps.gap {
            let stroke = Stroke {
                dash: None,
                ..ps.stroke.clone()
            };
            self.emit(Node::Stroke {
                path: path.clone(),
                paint: Paint::Solid(gap),
                stroke,
            });
        }
        self.emit(Node::Stroke {
            path: path.clone(),
            paint: Paint::Solid(ps.color),
            stroke: ps.stroke,
        });
    }

    /// Appends a node, clipped by the current clip and meta regions.
    pub(super) fn emit(&mut self, node: Node) {
        if self.out.count < MAX_NODES {
            self.out
                .push(node, &self.dc.meta, &self.dc.clip, &self.dev.universe);
        }
    }

    // ----- Path brackets -----

    /// `BeginPath`.
    pub(super) fn begin_path(&mut self) {
        self.bracket = Some(Bracket {
            path: Path::new(),
            need_move: true,
        });
        self.path = None;
    }

    /// `EndPath`.
    pub(super) fn end_path(&mut self) {
        if let Some(b) = self.bracket.take() {
            self.path = Some(DevPath {
                path: b.path,
                widened: false,
            });
        }
    }

    /// `AbortPath`.
    pub(super) fn abort_path(&mut self) {
        self.bracket = None;
        self.path = None;
    }

    /// `CloseFigure`.
    pub(super) fn close_figure(&mut self) {
        if let Some(b) = &mut self.bracket {
            b.path.close();
            b.need_move = true;
        }
    }

    /// `WidenPath`: later fills paint the pen outline with the brush.
    pub(super) fn widen_path(&mut self) {
        if let Some(p) = &mut self.path {
            p.widened = true;
        }
    }

    /// `FillPath`, `StrokePath`, and `StrokeAndFillPath`.
    pub(super) fn paint_path(&mut self, fill: bool, stroke: bool) {
        let Some(p) = self.path.take() else { return };
        let t = self.xform();
        if p.widened {
            // The widened outline is filled with the brush.
            if let (true, Some(ps), Some(paint)) = (fill, self.pen_stroke(&t), self.brush_paint()) {
                self.emit(Node::Stroke {
                    path: p.path.clone(),
                    paint,
                    stroke: Stroke {
                        dash: None,
                        ..ps.stroke
                    },
                });
            }
            return;
        }
        if fill {
            let closed = close_figures(&p.path);
            self.fill_dev(&closed, self.dc.poly_fill == ALTERNATE);
            if stroke {
                self.stroke_dev(&closed, &t);
            }
        } else if stroke {
            self.stroke_dev(&p.path, &t);
        }
    }

    /// `SelectClipPath`.
    pub(super) fn select_clip_path(&mut self, mode: u32) {
        if let Some(p) = self.path.take() {
            self.clip_combine(Shape::Path(close_figures(&p.path)), mode);
        }
    }

    // ----- Clipping -----

    fn next_serial(&mut self) -> u64 {
        self.serial += 1;
        self.serial
    }

    /// Combines the clip region with a device-space shape.
    pub(super) fn clip_combine(&mut self, shape: Shape, mode: u32) {
        let serial = self.next_serial();
        let universe = self.dev.universe;
        self.dc.clip.combine(shape, mode, universe, serial);
    }

    /// Removes the clip region (the meta region still applies).
    pub(super) fn clip_reset(&mut self) {
        let serial = self.next_serial();
        self.dc.clip = Clip {
            items: Arc::new(Vec::new()),
            serial,
        };
    }

    /// `SetMetaRgn`: the meta region becomes its intersection with the clip region.
    pub(super) fn set_meta_region(&mut self) {
        let items = std::mem::take(&mut self.dc.clip.items);
        let serial = self.next_serial();
        Arc::make_mut(&mut self.dc.meta.items).extend(items.iter().cloned());
        self.dc.meta.serial = serial;
        self.clip_reset();
    }

    /// `OffsetClipRgn` by a logical offset.
    pub(super) fn offset_clip(&mut self, dx: f64, dy: f64) {
        let t = self.xform();
        let (x, y) = (t.a * dx + t.c * dy, t.b * dx + t.d * dy);
        let serial = self.next_serial();
        self.dc.clip.offset(x as f32, y as f32, serial);
    }

    /// A logical rectangle as a device-space clip shape.
    pub(super) fn logical_rect_shape(&self, l: f64, t: f64, r: f64, b: f64) -> Shape {
        self.logical_rects_shape(&[[l, t, r, b]])
    }

    /// Logical rectangles as a device-space clip shape.
    pub(super) fn logical_rects_shape<T: Copy + Into<f64>>(&self, rects: &[[T; 4]]) -> Shape {
        let x = self.xform();
        let axis_aligned = x.b.abs() < 1e-12 && x.c.abs() < 1e-12;
        let mut out = Vec::new();
        let mut path = Path::new();
        for r in rects {
            let [l, t, rr, b] = r.map(Into::into);
            let p0 = x.apply(Point::new(l as f32, t as f32));
            let p1 = x.apply(Point::new(rr as f32, b as f32));
            if axis_aligned {
                let d = Rect::from_ltrb(
                    p0.x.min(p1.x),
                    p0.y.min(p1.y),
                    p0.x.max(p1.x),
                    p0.y.max(p1.y),
                );
                if d.w > 0.0 && d.h > 0.0 {
                    out.push(d);
                }
            } else {
                let lr = Rect::from_ltrb(
                    l.min(rr) as f32,
                    t.min(b) as f32,
                    l.max(rr) as f32,
                    t.max(b) as f32,
                );
                path.extend(&Path::rect(lr).transform(&x));
            }
        }
        if axis_aligned {
            Shape::Rects(out)
        } else {
            Shape::Path(path)
        }
    }
}

/// Length of the linear part of `t` applied to `(x, y)`.
pub(super) fn vec_len(t: &Affine, x: f64, y: f64) -> f64 {
    (t.a * x + t.c * y).hypot(t.b * x + t.d * y)
}

fn valid_ext(x: f64, y: f64) -> bool {
    x != 0.0 && y != 0.0 && x.is_finite() && y.is_finite()
}

fn valid_affine(x: &Affine) -> bool {
    let vals = [x.a, x.b, x.c, x.d, x.e, x.f];
    vals.iter().all(|v| v.is_finite() && v.abs() < 1e12) && (x.a * x.d - x.b * x.c).abs() > 1e-18
}

/// Closes every open sub-path (fills and clip paths close figures implicitly).
pub(super) fn close_figures(p: &Path) -> Path {
    let mut out = Path::new();
    let mut open = false;
    for el in &p.els {
        match *el {
            PathEl::MoveTo(q) => {
                if open {
                    out.close();
                }
                out.move_to(q);
                open = true;
            }
            PathEl::LineTo(q) => {
                out.line_to(q);
                open = true;
            }
            PathEl::QuadTo(c, q) => {
                out.quad_to(c, q);
                open = true;
            }
            PathEl::CubicTo(c1, c2, q) => {
                out.cubic_to(c1, c2, q);
                open = true;
            }
            PathEl::Close => {
                out.close();
                open = false;
            }
        }
    }
    if open {
        out.close();
    }
    out
}
