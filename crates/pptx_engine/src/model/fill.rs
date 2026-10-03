//! Fills, outlines, and effects (`spPr` children and theme format styles).

use super::color::{ColorContext, Rgba, find_color, percent};
use crate::units::emu_to_pt;
use crate::xml::{Ns, NodeId, XmlDoc};

/// A rectangle given as fractional insets from each edge (DrawingML `RelativeRect`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RelRect {
    /// Left inset fraction.
    pub l: f32,
    /// Top inset fraction.
    pub t: f32,
    /// Right inset fraction.
    pub r: f32,
    /// Bottom inset fraction.
    pub b: f32,
}

impl RelRect {
    fn parse(doc: &XmlDoc, node: Option<NodeId>) -> Self {
        let Some(n) = node else { return Self::default() };
        let f = |a: &str| doc.attr(n, a).map_or(0.0, |v| percent(v) as f32);
        Self { l: f("l"), t: f("t"), r: f("r"), b: f("b") }
    }

    /// Whether all insets are zero.
    pub fn is_zero(&self) -> bool {
        self.l == 0.0 && self.t == 0.0 && self.r == 0.0 && self.b == 0.0
    }
}

/// A gradient stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GradientStop {
    /// Position in `0..=1`.
    pub pos: f32,
    /// Color at the stop.
    pub color: Rgba,
}

/// Gradient geometry.
#[derive(Clone, Debug, PartialEq)]
pub enum GradientKind {
    /// Linear gradient at `angle` degrees (clockwise from the x axis).
    Linear {
        /// Direction in degrees.
        angle: f32,
        /// Whether the angle scales with the shape's aspect ratio.
        scaled: bool,
    },
    /// Radial-like gradient emanating from `focus`.
    Path {
        /// Contour shape.
        shape: PathShape,
        /// The focus rectangle (fractional insets of the fill box).
        focus: RelRect,
    },
}

/// Contour of a path gradient.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathShape {
    /// Elliptical contours.
    Circle,
    /// Rectangular contours.
    Rect,
    /// Contours following the shape outline (approximated by rectangles).
    Shape,
}

/// A gradient fill.
#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    /// Stops sorted by position.
    pub stops: Vec<GradientStop>,
    /// Geometry.
    pub kind: GradientKind,
    /// Whether the gradient rotates with the shape.
    pub rotate_with_shape: bool,
}

/// An effect applied to a picture (`blip` children).
#[derive(Clone, Debug, PartialEq)]
pub enum BlipEffect {
    /// Multiply alpha.
    AlphaModFix(f32),
    /// Convert to grayscale.
    Grayscale,
    /// Black-and-white threshold.
    BiLevel(f32),
    /// Brightness/contrast (fractions in `-1..=1`).
    Lum {
        /// Brightness adjustment.
        bright: f32,
        /// Contrast adjustment.
        contrast: f32,
    },
    /// Two-color duotone (dark, light).
    Duotone(Rgba, Rgba),
    /// Replace one color (with tolerance) by another, typically to transparent.
    ClrChange {
        /// Color to replace.
        from: Rgba,
        /// Replacement color.
        to: Rgba,
    },
    /// Replace all color with one, keeping alpha.
    ColorReplace(Rgba),
    /// Alpha threshold.
    AlphaBiLevel(f32),
}

/// How an image fills its box.
#[derive(Clone, Debug, PartialEq)]
pub enum ImageMode {
    /// Stretch into the fill rectangle.
    Stretch(RelRect),
    /// Repeat the image.
    Tile {
        /// Horizontal offset (points).
        tx: f32,
        /// Vertical offset (points).
        ty: f32,
        /// Horizontal scale.
        sx: f32,
        /// Vertical scale.
        sy: f32,
        /// Mirroring: `none`, `x`, `y`, or `xy`.
        flip: String,
        /// Alignment of the first tile.
        align: String,
    },
}

/// A picture fill.
#[derive(Clone, Debug, PartialEq)]
pub struct ImageFill {
    /// Image part name.
    pub part: Option<String>,
    /// Source crop.
    pub src_rect: RelRect,
    /// Stretch or tile.
    pub mode: ImageMode,
    /// Picture effects in order.
    pub effects: Vec<BlipEffect>,
    /// Whether the fill rotates with the shape.
    pub rotate_with_shape: bool,
}

/// A resolved fill.
#[derive(Clone, Debug, PartialEq)]
pub enum Fill {
    /// Explicitly unfilled.
    None,
    /// Solid color.
    Solid(Rgba),
    /// Gradient.
    Gradient(Gradient),
    /// Two-color pattern.
    Pattern {
        /// Preset pattern name.
        preset: String,
        /// Foreground color.
        fg: Rgba,
        /// Background color.
        bg: Rgba,
    },
    /// Picture.
    Image(Box<ImageFill>),
    /// Inherit the enclosing group's fill.
    Group,
}

impl Fill {
    /// Whether this fill paints nothing.
    pub fn is_none(&self) -> bool {
        matches!(self, Fill::None)
    }

    /// A representative solid color (first stop for gradients).
    pub fn representative_color(&self) -> Option<Rgba> {
        match self {
            Fill::Solid(c) => Some(*c),
            Fill::Gradient(g) => g.stops.first().map(|s| s.color),
            Fill::Pattern { fg, .. } => Some(*fg),
            _ => None,
        }
    }
}

const FILL_ELEMENTS: [&str; 6] = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"];

/// Resolves relationship ids to part names.
pub type RelResolver<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The fill-choice child of `parent`, if any.
pub fn fill_child(doc: &XmlDoc, parent: NodeId) -> Option<NodeId> {
    doc.children(parent).find(|&c| doc.ns(c) == Ns::A && FILL_ELEMENTS.contains(&doc.local(c)))
}

/// Parses the fill-choice child of `parent`.
pub fn find_fill(doc: &XmlDoc, parent: NodeId, ctx: &ColorContext<'_>, rels: RelResolver<'_>) -> Option<Fill> {
    fill_child(doc, parent).map(|f| parse_fill(doc, f, ctx, rels))
}

/// Parses a fill element.
pub fn parse_fill(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>, rels: RelResolver<'_>) -> Fill {
    match doc.local(node) {
        "noFill" => Fill::None,
        "solidFill" => find_color(doc, node, ctx).map_or(Fill::None, Fill::Solid),
        "gradFill" => parse_gradient(doc, node, ctx),
        "pattFill" => {
            let preset = doc.attr(node, "prst").unwrap_or("pct5").to_owned();
            let fg = doc.child(node, Ns::A, "fgClr").and_then(|c| find_color(doc, c, ctx)).unwrap_or(Rgba::BLACK);
            let bg = doc.child(node, Ns::A, "bgClr").and_then(|c| find_color(doc, c, ctx)).unwrap_or(Rgba::WHITE);
            Fill::Pattern { preset, fg, bg }
        }
        "blipFill" => parse_blip_fill(doc, node, ctx, rels).map_or(Fill::None, |f| Fill::Image(Box::new(f))),
        "grpFill" => Fill::Group,
        _ => Fill::None,
    }
}

fn parse_gradient(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>) -> Fill {
    let mut stops: Vec<GradientStop> = doc
        .child(node, Ns::A, "gsLst")
        .map(|l| {
            doc.children_named(l, Ns::A, "gs")
                .filter_map(|gs| {
                    let pos = doc.attr(gs, "pos").map_or(0.0, |v| percent(v) as f32).clamp(0.0, 1.0);
                    Some(GradientStop { pos, color: find_color(doc, gs, ctx)? })
                })
                .collect()
        })
        .unwrap_or_default();
    stops.sort_by(|a, b| a.pos.total_cmp(&b.pos));
    if stops.is_empty() {
        return Fill::None;
    }
    let kind = if let Some(lin) = doc.child(node, Ns::A, "lin") {
        GradientKind::Linear {
            angle: doc.attr_f64(lin, "ang").map_or(0.0, |a| (a / 60000.0) as f32),
            scaled: doc.attr_bool(lin, "scaled").unwrap_or(false),
        }
    } else if let Some(path) = doc.child(node, Ns::A, "path") {
        GradientKind::Path {
            shape: match doc.attr(path, "path") {
                Some("rect") => PathShape::Rect,
                Some("shape") => PathShape::Shape,
                _ => PathShape::Circle,
            },
            focus: RelRect::parse(doc, doc.child(path, Ns::A, "fillToRect")),
        }
    } else {
        GradientKind::Linear { angle: 90.0, scaled: false }
    };
    Fill::Gradient(Gradient {
        stops,
        kind,
        rotate_with_shape: doc.attr_bool(node, "rotWithShape").unwrap_or(true),
    })
}

/// Parses a `blipFill` (`a:blipFill` or `p:blipFill`).
pub fn parse_blip_fill(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>, rels: RelResolver<'_>) -> Option<ImageFill> {
    let blip = doc.child(node, Ns::A, "blip");
    let part = blip.and_then(|b| doc.attr_ns(b, Ns::R, "embed")).and_then(|id| rels(id));
    let mut effects = Vec::new();
    if let Some(b) = blip {
        for e in doc.children(b) {
            let val = |a: &str| doc.attr(e, a).map_or(0.0, |v| percent(v) as f32);
            match doc.local(e) {
                "alphaModFix" => effects.push(BlipEffect::AlphaModFix(doc.attr(e, "amt").map_or(1.0, |v| percent(v) as f32))),
                "grayscl" => effects.push(BlipEffect::Grayscale),
                "biLevel" => effects.push(BlipEffect::BiLevel(val("thresh"))),
                "lum" => effects.push(BlipEffect::Lum { bright: val("bright"), contrast: val("contrast") }),
                "duotone" => {
                    let colors: Vec<Rgba> = doc
                        .children(e)
                        .filter(|&c| super::color::is_color_element(doc, c))
                        .filter_map(|c| super::color::parse_color(doc, c, ctx))
                        .collect();
                    if colors.len() == 2 {
                        effects.push(BlipEffect::Duotone(colors[0], colors[1]));
                    }
                }
                "clrChange" => {
                    let from = doc.child(e, Ns::A, "clrFrom").and_then(|c| find_color(doc, c, ctx));
                    let to = doc.child(e, Ns::A, "clrTo").and_then(|c| find_color(doc, c, ctx));
                    if let (Some(from), Some(to)) = (from, to) {
                        effects.push(BlipEffect::ClrChange { from, to });
                    }
                }
                "clrRepl" => {
                    if let Some(c) = find_color(doc, e, ctx) {
                        effects.push(BlipEffect::ColorReplace(c));
                    }
                }
                "alphaBiLevel" => effects.push(BlipEffect::AlphaBiLevel(val("thresh"))),
                _ => {}
            }
        }
    }
    let src_rect = RelRect::parse(doc, doc.child(node, Ns::A, "srcRect"));
    let mode = if let Some(tile) = doc.child(node, Ns::A, "tile") {
        let n = |a: &str, d: f64| doc.attr_f64(tile, a).unwrap_or(d);
        ImageMode::Tile {
            tx: emu_to_pt(n("tx", 0.0)),
            ty: emu_to_pt(n("ty", 0.0)),
            sx: (n("sx", 100_000.0) / 100_000.0) as f32,
            sy: (n("sy", 100_000.0) / 100_000.0) as f32,
            flip: doc.attr(tile, "flip").unwrap_or("none").to_owned(),
            align: doc.attr(tile, "algn").unwrap_or("tl").to_owned(),
        }
    } else {
        let stretch = doc.child(node, Ns::A, "stretch");
        ImageMode::Stretch(RelRect::parse(doc, stretch.and_then(|s| doc.child(s, Ns::A, "fillRect"))))
    };
    Some(ImageFill {
        part,
        src_rect,
        mode,
        effects,
        rotate_with_shape: doc.attr_bool(node, "rotWithShape").unwrap_or(true),
    })
}

/// Line cap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cap {
    /// Flat (butt).
    Flat,
    /// Round.
    Round,
    /// Square.
    Square,
}

/// Line join.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Join {
    /// Round.
    Round,
    /// Bevel.
    Bevel,
    /// Miter with limit (multiple of the width).
    Miter(f32),
}

/// Compound line type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Compound {
    /// Single line.
    Single,
    /// Two equal lines.
    Double,
    /// Thick then thin.
    ThickThin,
    /// Thin then thick.
    ThinThick,
    /// Three lines.
    Triple,
}

/// Arrowhead kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEndKind {
    /// No decoration.
    None,
    /// Filled triangle.
    Triangle,
    /// Swept-back "stealth" arrow.
    Stealth,
    /// Diamond.
    Diamond,
    /// Ellipse.
    Oval,
    /// Open arrow (two strokes).
    Arrow,
}

/// A line-end decoration with size multipliers (`sm`, `med`, `lg` → 2, 3, 5).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineEnd {
    /// Kind of decoration.
    pub kind: LineEndKind,
    /// Width multiplier of the line width.
    pub w: f32,
    /// Length multiplier of the line width.
    pub len: f32,
}

/// Dash pattern in multiples of the line width (`None` = solid).
pub type Dash = Option<Vec<f32>>;

/// Partially specified outline (each source may set any subset).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LineProps {
    /// Width in points.
    pub width: Option<f32>,
    /// Stroke paint.
    pub fill: Option<Fill>,
    /// Dash pattern.
    pub dash: Option<Dash>,
    /// Cap.
    pub cap: Option<Cap>,
    /// Join.
    pub join: Option<Join>,
    /// Compound type.
    pub compound: Option<Compound>,
    /// Start decoration.
    pub head: Option<LineEnd>,
    /// End decoration.
    pub tail: Option<LineEnd>,
}

impl LineProps {
    /// Fills unset fields from `lower`.
    pub fn inherit(&mut self, lower: &LineProps) {
        macro_rules! take {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = lower.$f.clone(); } )* };
        }
        take!(width, fill, dash, cap, join, compound, head, tail);
    }
}

/// A fully resolved outline.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// Width in points.
    pub width: f32,
    /// Stroke paint.
    pub fill: Fill,
    /// Dash pattern.
    pub dash: Dash,
    /// Cap.
    pub cap: Cap,
    /// Join.
    pub join: Join,
    /// Compound type.
    pub compound: Compound,
    /// Start decoration.
    pub head: Option<LineEnd>,
    /// End decoration.
    pub tail: Option<LineEnd>,
}

impl LineProps {
    /// Resolves to a concrete line; `None` when the outline paints nothing.
    pub fn resolve(&self) -> Option<Line> {
        let fill = self.fill.clone().unwrap_or(Fill::None);
        if fill.is_none() {
            return None;
        }
        Some(Line {
            // ECMA-376 default width is 0, which renders as a hairline (0.75pt in practice).
            width: self.width.filter(|w| *w > 0.0).unwrap_or(0.75),
            fill,
            dash: self.dash.clone().unwrap_or(None),
            cap: self.cap.unwrap_or(Cap::Flat),
            join: self.join.unwrap_or(Join::Round),
            compound: self.compound.unwrap_or(Compound::Single),
            head: self.head.filter(|h| h.kind != LineEndKind::None),
            tail: self.tail.filter(|t| t.kind != LineEndKind::None),
        })
    }
}

fn line_end(doc: &XmlDoc, node: NodeId) -> LineEnd {
    let size = |a: &str| match doc.attr(node, a) {
        Some("sm") => 2.0,
        Some("lg") => 5.0,
        _ => 3.0,
    };
    LineEnd {
        kind: match doc.attr(node, "type") {
            Some("triangle") => LineEndKind::Triangle,
            Some("stealth") => LineEndKind::Stealth,
            Some("diamond") => LineEndKind::Diamond,
            Some("oval") => LineEndKind::Oval,
            Some("arrow") => LineEndKind::Arrow,
            _ => LineEndKind::None,
        },
        w: size("w"),
        len: size("len"),
    }
}

/// Preset dash patterns in multiples of the line width.
pub fn preset_dash(name: &str) -> Dash {
    let p: &[f32] = match name {
        "dash" => &[4.0, 3.0],
        "dashDot" => &[4.0, 3.0, 1.0, 3.0],
        "dot" => &[1.0, 3.0],
        "lgDash" => &[8.0, 3.0],
        "lgDashDot" => &[8.0, 3.0, 1.0, 3.0],
        "lgDashDotDot" => &[8.0, 3.0, 1.0, 3.0, 1.0, 3.0],
        "sysDash" => &[3.0, 1.0],
        "sysDot" => &[1.0, 1.0],
        "sysDashDot" => &[3.0, 1.0, 1.0, 1.0],
        "sysDashDotDot" => &[3.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        _ => return None,
    };
    Some(p.to_vec())
}

/// Parses an `a:ln` element.
pub fn parse_line(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>, rels: RelResolver<'_>) -> LineProps {
    let mut p = LineProps {
        width: doc.attr_f64(node, "w").map(emu_to_pt),
        fill: find_fill(doc, node, ctx, rels),
        cap: doc.attr(node, "cap").map(|c| match c {
            "rnd" => Cap::Round,
            "sq" => Cap::Square,
            _ => Cap::Flat,
        }),
        compound: doc.attr(node, "cmpd").map(|c| match c {
            "dbl" => Compound::Double,
            "thickThin" => Compound::ThickThin,
            "thinThick" => Compound::ThinThick,
            "tri" => Compound::Triple,
            _ => Compound::Single,
        }),
        ..Default::default()
    };
    for c in doc.children(node) {
        match doc.local(c) {
            "prstDash" => p.dash = Some(preset_dash(doc.attr(c, "val").unwrap_or("solid"))),
            "custDash" => {
                let mut pattern = Vec::new();
                for ds in doc.children_named(c, Ns::A, "ds") {
                    let d = doc.attr(ds, "d").map_or(0.0, |v| percent(v) as f32);
                    let sp = doc.attr(ds, "sp").map_or(0.0, |v| percent(v) as f32);
                    pattern.push(d);
                    pattern.push(sp);
                }
                p.dash = Some((!pattern.is_empty()).then_some(pattern));
            }
            "round" => p.join = Some(Join::Round),
            "bevel" => p.join = Some(Join::Bevel),
            "miter" => p.join = Some(Join::Miter(doc.attr(c, "lim").map_or(8.0, |v| percent(v) as f32).max(1.0))),
            "headEnd" => p.head = Some(line_end(doc, c)),
            "tailEnd" => p.tail = Some(line_end(doc, c)),
            _ => {}
        }
    }
    p
}

/// Alignment anchor for shadow scaling.
pub type Align = String;

/// An outer or inner shadow.
#[derive(Clone, Debug, PartialEq)]
pub struct Shadow {
    /// Blur radius (points).
    pub blur: f32,
    /// Offset distance (points).
    pub dist: f32,
    /// Offset direction (degrees, clockwise from +x).
    pub dir: f32,
    /// Horizontal scale.
    pub sx: f32,
    /// Vertical scale.
    pub sy: f32,
    /// Horizontal skew (degrees).
    pub kx: f32,
    /// Vertical skew (degrees).
    pub ky: f32,
    /// Scaling anchor.
    pub align: Align,
    /// Shadow color.
    pub color: Rgba,
}

/// A glow.
#[derive(Clone, Debug, PartialEq)]
pub struct Glow {
    /// Radius (points).
    pub radius: f32,
    /// Color.
    pub color: Rgba,
}

/// A reflection.
#[derive(Clone, Debug, PartialEq)]
pub struct Reflection {
    /// Blur radius (points).
    pub blur: f32,
    /// Start alpha.
    pub start_alpha: f32,
    /// Start position of the alpha ramp.
    pub start_pos: f32,
    /// End alpha.
    pub end_alpha: f32,
    /// End position of the alpha ramp.
    pub end_pos: f32,
    /// Distance from the shape (points).
    pub dist: f32,
    /// Vertical scale (negative for a mirror image).
    pub sy: f32,
}

/// Visual effects of a shape.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Effects {
    /// Outer shadow.
    pub outer_shadow: Option<Shadow>,
    /// Inner shadow.
    pub inner_shadow: Option<Shadow>,
    /// Glow.
    pub glow: Option<Glow>,
    /// Soft-edge radius (points).
    pub soft_edge: Option<f32>,
    /// Reflection.
    pub reflection: Option<Reflection>,
}

impl Effects {
    /// Whether no effect is present.
    pub fn is_empty(&self) -> bool {
        self.outer_shadow.is_none()
            && self.inner_shadow.is_none()
            && self.glow.is_none()
            && self.soft_edge.is_none()
            && self.reflection.is_none()
    }
}

fn shadow(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>) -> Shadow {
    let n = |a: &str, d: f64| doc.attr_f64(node, a).unwrap_or(d);
    Shadow {
        blur: emu_to_pt(n("blurRad", 0.0)),
        dist: emu_to_pt(n("dist", 0.0)),
        dir: (n("dir", 0.0) / 60000.0) as f32,
        sx: (n("sx", 100_000.0) / 100_000.0) as f32,
        sy: (n("sy", 100_000.0) / 100_000.0) as f32,
        kx: (n("kx", 0.0) / 60000.0) as f32,
        ky: (n("ky", 0.0) / 60000.0) as f32,
        align: doc.attr(node, "algn").unwrap_or("b").to_owned(),
        color: find_color(doc, node, ctx).unwrap_or(Rgba { a: 0.35, ..Rgba::BLACK }),
    }
}

/// Parses an `a:effectLst` element.
pub fn parse_effects(doc: &XmlDoc, node: NodeId, ctx: &ColorContext<'_>) -> Effects {
    let mut fx = Effects::default();
    for c in doc.children(node) {
        let n = |a: &str, d: f64| doc.attr_f64(c, a).unwrap_or(d);
        match doc.local(c) {
            "outerShdw" => fx.outer_shadow = Some(shadow(doc, c, ctx)),
            "innerShdw" => fx.inner_shadow = Some(shadow(doc, c, ctx)),
            "prstShdw" => {
                let mut s = shadow(doc, c, ctx);
                s.blur = 0.0;
                s.align = "ctr".into();
                fx.outer_shadow = Some(s);
            }
            "glow" => {
                fx.glow = Some(Glow {
                    radius: emu_to_pt(n("rad", 0.0)),
                    color: find_color(doc, c, ctx).unwrap_or(Rgba::BLACK),
                });
            }
            "softEdge" => fx.soft_edge = Some(emu_to_pt(n("rad", 0.0))),
            "reflection" => {
                fx.reflection = Some(Reflection {
                    blur: emu_to_pt(n("blurRad", 0.0)),
                    start_alpha: (n("stA", 100_000.0) / 100_000.0) as f32,
                    start_pos: (n("stPos", 0.0) / 100_000.0) as f32,
                    end_alpha: (n("endA", 0.0) / 100_000.0) as f32,
                    end_pos: (n("endPos", 100_000.0) / 100_000.0) as f32,
                    dist: emu_to_pt(n("dist", 0.0)),
                    sy: (n("sy", -100_000.0) / 100_000.0) as f32,
                });
            }
            _ => {}
        }
    }
    fx
}

#[cfg(test)]
mod test;
