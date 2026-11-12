//! Automatic chart formatting: theme palette, default lines and fills, and
//! text style resolution.
//!
//! Elements without explicit `c:spPr`/`c:txPr` get Office's automatic
//! formatting for chart style 2 (the default `c:style`): black text, gray axis
//! and grid lines, and accent-colored series.

use super::model::{ChartModel, ShapeProps, TextProps};
use crate::model::color::{ColorContext, Rgba, hsl_to_rgb, rgb_to_hsl};
use crate::model::fill::{Fill, Line, LineProps};
use crate::render::label::LabelStyle;

/// Theme colors used by automatic formatting.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Palette {
    pub tx1: Rgba,
    pub bg1: Rgba,
    pub dk1: Rgba,
    pub lt1: Rgba,
    pub accents: [Rgba; 6],
}

impl Palette {
    /// Reads the palette from a color context.
    pub fn new(c: &ColorContext<'_>) -> Self {
        let get = |n: &str, d: Rgba| c.scheme_color(n).unwrap_or(d);
        let defaults = crate::model::color::ColorScheme::default();
        let accent = |i: usize| get(&format!("accent{}", i + 1), defaults.colors[4 + i]);
        Self {
            tx1: get("tx1", Rgba::BLACK),
            bg1: get("bg1", Rgba::WHITE),
            dk1: get("dk1", Rgba::BLACK),
            lt1: get("lt1", Rgba::WHITE),
            accents: [
                accent(0),
                accent(1),
                accent(2),
                accent(3),
                accent(4),
                accent(5),
            ],
        }
    }

    /// Automatic color of series (or varied point) `i`: the Office 2013+
    /// "colorful" palette, accents 1-6 then luminance variations.
    pub fn series(&self, i: usize) -> Rgba {
        let base = self.accents[i % 6];
        match (i / 6) % 9 {
            1 => lum(base, 0.6, 0.0),
            2 => lum(base, 0.8, 0.2),
            3 => lum(base, 0.8, 0.0),
            4 => lum(base, 0.6, 0.4),
            5 => lum(base, 0.5, 0.0),
            6 => lum(base, 0.7, 0.3),
            7 => lum(base, 0.7, 0.0),
            8 => lum(base, 0.5, 0.5),
            _ => base,
        }
    }
}

/// `lumMod`/`lumOff` in HSL space.
pub(crate) fn lum(c: Rgba, modulate: f64, offset: f64) -> Rgba {
    let (h, s, l) = rgb_to_hsl(f64::from(c.r), f64::from(c.g), f64::from(c.b));
    Rgba {
        a: c.a,
        ..hsl_to_rgb(h, s, (l * modulate + offset).clamp(0.0, 1.0))
    }
}

const GAMMA: f64 = 2.3;

/// DrawingML `tint` (blend toward white in linear RGB), as the color model does.
pub(crate) fn tint(c: Rgba, amount: f64) -> Rgba {
    let f = |v: f32| {
        (1.0 - (1.0 - f64::from(v).clamp(0.0, 1.0).powf(GAMMA)) * amount)
            .clamp(0.0, 1.0)
            .powf(1.0 / GAMMA) as f32
    };
    Rgba {
        r: f(c.r),
        g: f(c.g),
        b: f(c.b),
        a: c.a,
    }
}

/// DrawingML `shade` (blend toward black in linear RGB).
pub(crate) fn shade(c: Rgba, amount: f64) -> Rgba {
    let f = |v: f32| {
        (f64::from(v).clamp(0.0, 1.0).powf(GAMMA) * amount)
            .clamp(0.0, 1.0)
            .powf(1.0 / GAMMA) as f32
    };
    Rgba {
        r: f(c.r),
        g: f(c.g),
        b: f(c.b),
        a: c.a,
    }
}

/// A solid line of `width` points.
pub(crate) fn solid_line(color: Rgba, width: f32) -> LineProps {
    LineProps {
        width: Some(width),
        fill: Some(Fill::Solid(color)),
        ..Default::default()
    }
}

/// Resolves an element outline: explicit properties over the automatic ones.
pub(crate) fn resolve_line(explicit: Option<&LineProps>, auto: Option<LineProps>) -> Option<Line> {
    match (explicit, auto) {
        (Some(e), Some(a)) => {
            let mut l = e.clone();
            l.inherit(&a);
            l.resolve()
        }
        (Some(e), None) => {
            e.fill.as_ref()?;
            e.resolve()
        }
        (None, Some(a)) => a.resolve(),
        (None, None) => None,
    }
}

/// Resolves an element fill: explicit or automatic.
pub(crate) fn resolve_fill(shape: &ShapeProps, auto: Option<Fill>) -> Option<Fill> {
    match &shape.fill {
        Some(Fill::None) => None,
        Some(f) => Some(f.clone()),
        None => auto,
    }
}

/// Text roles with distinct automatic sizes and weights.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    Title,
    AxisTitle,
    Other,
}

impl ChartModel {
    /// Automatic line of axes and major gridlines.
    pub fn auto_axis_line(&self) -> LineProps {
        let base = if self.style <= 32 {
            self.palette.tx1
        } else {
            self.palette.dk1
        };
        solid_line(tint(base, 0.75), 0.75)
    }

    /// Automatic line of minor gridlines.
    pub fn auto_minor_line(&self) -> LineProps {
        solid_line(tint(self.palette.tx1, 0.5), 0.75)
    }

    /// Automatic color of series or point `i`.
    pub fn auto_color(&self, i: usize) -> Rgba {
        match self.style {
            1 => {
                // Grayscale style: evenly spaced grays.
                let k = 0.2 + 0.6 * ((i % 6) as f32 / 5.0);
                Rgba {
                    r: k,
                    g: k,
                    b: k,
                    a: 1.0,
                }
            }
            3..=8 => {
                // Monochrome styles: shades and tints of one accent.
                let base = self.palette.accents[(self.style - 3) as usize];
                let t = (i % 6) as f64;
                if t < 3.0 {
                    shade(base, 1.0 - 0.18 * (2.0 - t))
                } else {
                    tint(base, 1.0 - 0.2 * (t - 2.0))
                }
            }
            _ => self.palette.series(i),
        }
    }

    /// The base character properties of a role (before element `txPr`).
    pub fn base_text(&self, role: Role) -> LabelStyle {
        let global = &self.text.props;
        let color = if self.style >= 41 {
            self.palette.lt1
        } else {
            self.palette.tx1
        };
        let (size, bold) = match role {
            Role::Title => (global.size.map_or(18.0, |s| s * 1.2), true),
            Role::AxisTitle => (global.size.unwrap_or(10.0), true),
            Role::Other => (global.size.unwrap_or(10.0), false),
        };
        let mut style = LabelStyle {
            family: global.family.clone().unwrap_or_else(|| self.font.clone()),
            size,
            bold: global.bold.unwrap_or(false) || bold,
            italic: global.italic.unwrap_or(false),
            underline: global.underline.unwrap_or(false),
            color: global.color.unwrap_or(color),
        };
        if role != Role::Other {
            // The global txPr's weight applies, but titles default to bold.
            style.bold = global.bold.unwrap_or(bold);
        }
        style
    }
}

/// Applies partial properties over a resolved style.
pub(crate) fn apply(props: &TextProps, base: &LabelStyle) -> LabelStyle {
    LabelStyle {
        family: props.family.clone().unwrap_or_else(|| base.family.clone()),
        size: props.size.unwrap_or(base.size).clamp(1.0, 400.0),
        bold: props.bold.unwrap_or(base.bold),
        italic: props.italic.unwrap_or(base.italic),
        underline: props.underline.unwrap_or(base.underline),
        color: props.color.unwrap_or(base.color),
    }
}
