//! Paint values shared by layer styles, fill layers, shape strokes, and
//! adjustments: blend modes, colors, gradients, patterns, contours, and
//! units, between descriptors and the model.
//!
//! The `put_*` helpers change a descriptor item only when the model's value
//! differs from what the item already reads as, so unchanged values keep
//! their stored form (an HSB color, a percent stored as an integer, …).

pub(crate) mod color;

use crate::codec::descriptor::{Descriptor, Id, Value};
use crate::model::{
    BlendMode, ColorStop, Contour, Gradient, GradientKind, OpacityStop, PatternFill, Rgb,
};

/// Descriptor blend mode ids, by model mode.
const BLEND_IDS: [(BlendMode, &str); 28] = [
    (BlendMode::PassThrough, "passThrough"),
    (BlendMode::Normal, "Nrml"),
    (BlendMode::Dissolve, "Dslv"),
    (BlendMode::Darken, "Drkn"),
    (BlendMode::Multiply, "Mltp"),
    (BlendMode::ColorBurn, "CBrn"),
    (BlendMode::LinearBurn, "linearBurn"),
    (BlendMode::DarkerColor, "darkerColor"),
    (BlendMode::Lighten, "Lghn"),
    (BlendMode::Screen, "Scrn"),
    (BlendMode::ColorDodge, "CDdg"),
    (BlendMode::LinearDodge, "linearDodge"),
    (BlendMode::LighterColor, "lighterColor"),
    (BlendMode::Overlay, "Ovrl"),
    (BlendMode::SoftLight, "SftL"),
    (BlendMode::HardLight, "HrdL"),
    (BlendMode::VividLight, "vividLight"),
    (BlendMode::LinearLight, "linearLight"),
    (BlendMode::PinLight, "pinLight"),
    (BlendMode::HardMix, "hardMix"),
    (BlendMode::Difference, "Dfrn"),
    (BlendMode::Exclusion, "Xclu"),
    (BlendMode::Subtract, "blendSubtraction"),
    (BlendMode::Divide, "blendDivide"),
    (BlendMode::Hue, "H   "),
    (BlendMode::Saturation, "Strt"),
    (BlendMode::Color, "Clr "),
    (BlendMode::Luminosity, "Lmns"),
];

/// The model blend mode of a descriptor blend mode id (`Nrml`,
/// `linearBurn`, …); unknown ids are Normal.
pub(crate) fn blend_mode(id: &str) -> BlendMode {
    match id {
        "Sbtr" => BlendMode::Subtract,
        "pass" | "PasT" => BlendMode::PassThrough,
        _ => BLEND_IDS
            .iter()
            .find(|(_, s)| *s == id)
            .map_or(BlendMode::Normal, |(m, _)| *m),
    }
}

/// The descriptor value of a blend mode (`enum BlnM`).
pub(crate) fn blend_value(mode: BlendMode) -> Value {
    let id = BLEND_IDS
        .iter()
        .find(|(m, _)| *m == mode)
        .map_or("Nrml", |(_, s)| s);
    Value::Enum(Id::new("BlnM"), Id::new(id))
}

/// A blend mode item.
pub(crate) fn blend(d: &Descriptor, key: &str) -> Option<BlendMode> {
    d.enumeration(key).map(blend_mode)
}

/// A length item in pixels (points and other units at 72 per inch).
pub(crate) fn pixels(d: &Descriptor, key: &str) -> Option<f32> {
    let value = d.get(key)?;
    Some(match value.as_unit() {
        Some((unit, v)) => length_to_pixels(unit, v, 72.0) as f32,
        None => value.as_number()? as f32,
    })
}

/// A length in pixels at `resolution` pixels per inch.
pub(crate) fn length_to_pixels(unit: &str, v: f64, resolution: f64) -> f64 {
    match unit {
        "#Pnt" => v * resolution / 72.0,
        "#Mlm" => v * resolution / 25.4,
        "RrIn" => v * resolution,
        "RrCm" => v * resolution / 2.54,
        "RrPi" => v * resolution / 6.0,
        _ => v,
    }
}

/// A percentage item as a fraction (`#Prc`; plain numbers are percents).
pub(crate) fn percent(d: &Descriptor, key: &str) -> Option<f32> {
    Some((d.number(key)? / 100.0) as f32)
}

/// An angle item in degrees.
pub(crate) fn angle(d: &Descriptor, key: &str) -> Option<f32> {
    Some(d.number(key)? as f32)
}

/// A color item (a nested color descriptor).
pub(crate) fn color(d: &Descriptor, key: &str) -> Option<Rgb> {
    Some(color::from_descriptor(d.object(key)?))
}

/// A pixel length value.
pub(crate) fn pixels_value(v: f32) -> Value {
    Value::UnitDouble("#Pxl".into(), f64::from(v))
}

/// A percentage value for a fraction.
pub(crate) fn percent_value(v: f32) -> Value {
    Value::UnitDouble("#Prc".into(), f64::from(v) * 100.0)
}

/// An angle value in degrees.
pub(crate) fn angle_value(v: f32) -> Value {
    Value::UnitDouble("#Ang".into(), f64::from(v))
}

/// An enumeration value.
pub(crate) fn enum_value(ty: &str, value: &str) -> Value {
    Value::Enum(Id::new(ty), Id::new(value))
}

/// Sets a boolean item unless it already holds the value.
pub(crate) fn put_bool(d: &mut Descriptor, key: &str, v: bool) {
    if d.bool(key) != Some(v) {
        d.set(key, Value::Bool(v));
    }
}

/// Sets a pixel length item unless it already reads as the value.
pub(crate) fn put_pixels(d: &mut Descriptor, key: &str, v: f32) {
    if pixels(d, key) != Some(v) {
        d.set(key, pixels_value(v));
    }
}

/// Sets a percentage item unless it already reads as the value.
pub(crate) fn put_percent(d: &mut Descriptor, key: &str, v: f32) {
    if percent(d, key) != Some(v) {
        d.set(key, percent_value(v));
    }
}

/// Sets an angle item unless it already reads as the value.
pub(crate) fn put_angle(d: &mut Descriptor, key: &str, v: f32) {
    if angle(d, key) != Some(v) {
        d.set(key, angle_value(v));
    }
}

/// Sets a blend mode item unless it already reads as the mode.
pub(crate) fn put_blend(d: &mut Descriptor, key: &str, mode: BlendMode) {
    if blend(d, key) != Some(mode) {
        d.set(key, blend_value(mode));
    }
}

/// Sets an enumeration item unless it already holds the value.
pub(crate) fn put_enum(d: &mut Descriptor, key: &str, ty: &str, value: &str) {
    if d.enumeration(key) != Some(value) {
        d.set(key, enum_value(ty, value));
    }
}

/// Sets a color item unless it already reads as the color.
pub(crate) fn put_color(d: &mut Descriptor, key: &str, c: Rgb) {
    if color(d, key) != Some(c) {
        d.set(key, Value::Descriptor(color::to_descriptor(c)));
    }
}

/// Gradient kinds and their `GrdT` ids.
const GRADIENT_KINDS: [(GradientKind, &str); 5] = [
    (GradientKind::Linear, "Lnr "),
    (GradientKind::Radial, "Rdl "),
    (GradientKind::Angle, "Angl"),
    (GradientKind::Reflected, "Rflc"),
    (GradientKind::Diamond, "Dmnd"),
];

fn gradient_kind(id: &str) -> GradientKind {
    GRADIENT_KINDS
        .iter()
        .find(|(_, s)| *s == id)
        .map_or(GradientKind::Linear, |(k, _)| *k)
}

fn gradient_kind_id(kind: GradientKind) -> &'static str {
    GRADIENT_KINDS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or("Lnr ", |(_, s)| s)
}

/// Gradient locations run `0..=4096`.
const LOCATION_SCALE: f64 = 4096.0;

/// The colors, opacities, name, and smoothness of a gradient object
/// (`Grdn`); the rest of the returned gradient is the default. Noise
/// gradients are approximated by stops.
pub(crate) fn gradient_object(grad: &Descriptor) -> Gradient {
    let mut g = Gradient {
        name: grad.text("Nm  ").unwrap_or_default().to_string(),
        ..Gradient::default()
    };
    if grad.enumeration("GrdF") == Some("ClNs") {
        noise_object(grad, &mut g);
        return g;
    }
    g.smoothness = grad
        .number("Intr")
        .map_or(1.0, |v| (v / LOCATION_SCALE).clamp(0.0, 1.0) as f32);
    let stop = |s: &Descriptor| {
        (
            (s.number("Lctn").unwrap_or(0.0) / LOCATION_SCALE) as f32,
            (s.number("Mdpn").unwrap_or(50.0) / 100.0) as f32,
        )
    };
    g.colors = grad
        .list("Clrs")
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_descriptor)
        .map(|s| {
            let (location, midpoint) = stop(s);
            ColorStop {
                location,
                midpoint,
                color: color(s, "Clr ").unwrap_or(Rgb::BLACK),
            }
        })
        .collect();
    g.opacities = grad
        .list("Trns")
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_descriptor)
        .map(|s| {
            let (location, midpoint) = stop(s);
            OpacityStop {
                location,
                midpoint,
                opacity: percent(s, "Opct").unwrap_or(1.0),
            }
        })
        .collect();
    g
}

/// A noise gradient's settings.
pub(crate) struct Noise {
    /// The random seed.
    pub seed: u64,
    /// Roughness, `0..=1`.
    pub roughness: f64,
    /// The color model: `RGBC`, `HSBl`, `HSLC`, or `LbCl`.
    pub model: &'static str,
    /// The channels' lowest values (the fourth is opacity), `0..=1`.
    pub min: [f64; 4],
    /// The channels' highest values.
    pub max: [f64; 4],
    /// Opacity varies too.
    pub transparent: bool,
}

/// Approximates a noise gradient object (`ClNs`): see [`noise_stops`].
fn noise_object(grad: &Descriptor, g: &mut Gradient) {
    let range = |key: &str, default: f64| {
        let mut out = [default; 4];
        for (i, v) in out.iter_mut().enumerate() {
            if let Some(n) = grad
                .list(key)
                .and_then(|l| l.get(i))
                .and_then(Value::as_number)
            {
                *v = n / 100.0;
            }
        }
        out
    };
    let model = match grad.enumeration("ClrS") {
        Some("HSBl") => "HSBl",
        Some("HSLC") => "HSLC",
        Some("LbCl") => "LbCl",
        _ => "RGBC",
    };
    let noise = Noise {
        seed: grad.number("RndS").unwrap_or(1.0) as i64 as u64,
        roughness: grad.number("Smth").unwrap_or(2048.0) / LOCATION_SCALE,
        model,
        min: range("Mnm ", 0.0),
        max: range("Mxm ", 1.0),
        transparent: grad.bool("ShTr").unwrap_or(false),
    };
    noise_stops(&noise, g);
}

/// Approximates a noise gradient: evenly spaced stops (more as roughness
/// rises) with colors drawn, from the seed, inside the channel ranges.
pub(crate) fn noise_stops(noise: &Noise, g: &mut Gradient) {
    let mut state = noise.seed | 1;
    let mut random = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 53) as f64
    };
    let count = 2 + (noise.roughness.clamp(0.0, 1.0) * 14.0).round() as usize;
    let transparent = noise.transparent;
    g.colors.clear();
    g.opacities.clear();
    for i in 0..count {
        let location = i as f32 / (count - 1) as f32;
        let mut c = [0.0; 4];
        for (k, v) in c.iter_mut().enumerate() {
            *v = noise.min[k] + (noise.max[k] - noise.min[k]) * random();
        }
        let color = match noise.model {
            "HSBl" => color::hsb_to_rgb(c[0] * 360.0, c[1], c[2]),
            "HSLC" => color::hsl_to_rgb(c[0] * 360.0, c[1], c[2]),
            "LbCl" => color::lab_to_rgb(c[0] * 100.0, c[1] * 255.0 - 128.0, c[2] * 255.0 - 128.0),
            _ => Rgb::new(c[0] as f32, c[1] as f32, c[2] as f32),
        };
        g.colors.push(ColorStop {
            location,
            midpoint: 0.5,
            color,
        });
        if transparent {
            g.opacities.push(OpacityStop {
                location,
                midpoint: 0.5,
                opacity: c[3] as f32,
            });
        }
    }
    if !transparent {
        for location in [0.0, 1.0] {
            g.opacities.push(OpacityStop {
                location,
                midpoint: 0.5,
                opacity: 1.0,
            });
        }
    }
}

/// Whether two gradients have the same object part (name, stops,
/// smoothness).
fn same_object(a: &Gradient, b: &Gradient) -> bool {
    a.name == b.name
        && a.smoothness == b.smoothness
        && a.colors == b.colors
        && a.opacities == b.opacities
}

/// A gradient object (`Grdn`) for a gradient's stops: the `original` one
/// when it reads as the same stops.
pub(crate) fn gradient_object_descriptor(
    g: &Gradient,
    original: Option<&Descriptor>,
) -> Descriptor {
    if let Some(original) = original
        && same_object(&gradient_object(original), g)
    {
        return original.clone();
    }
    let location = |v: f32| Value::Integer((f64::from(v) * LOCATION_SCALE).round() as i32);
    let midpoint = |v: f32| Value::Integer((f64::from(v) * 100.0).round() as i32);
    let colors = g
        .colors
        .iter()
        .map(|s| {
            Value::Descriptor(
                Descriptor::new("Clrt")
                    .with("Clr ", Value::Descriptor(color::to_descriptor(s.color)))
                    .with("Type", enum_value("Clry", "UsrS"))
                    .with("Lctn", location(s.location))
                    .with("Mdpn", midpoint(s.midpoint)),
            )
        })
        .collect();
    let opacities = g
        .opacities
        .iter()
        .map(|s| {
            Value::Descriptor(
                Descriptor::new("TrnS")
                    .with("Opct", percent_value(s.opacity))
                    .with("Lctn", location(s.location))
                    .with("Mdpn", midpoint(s.midpoint)),
            )
        })
        .collect();
    let mut d = Descriptor::new("Grdn")
        .with("Nm  ", Value::Text(g.name.clone()))
        .with("GrdF", enum_value("GrdF", "CstS"))
        .with(
            "Intr",
            Value::Double((f64::from(g.smoothness) * LOCATION_SCALE).round()),
        )
        .with("Clrs", Value::List(colors))
        .with("Trns", Value::List(opacities));
    d.name = "Gradient".into();
    d
}

/// A gradient held in a descriptor with its layout: `Grad` plus `Type`,
/// `Angl`, `Rvrs`, `Dthr`, `Algn`, `Scl `, and `Ofst` (gradient fill
/// layers, overlays, strokes).
pub(crate) fn gradient(d: &Descriptor) -> Option<Gradient> {
    let mut g = gradient_object(d.object("Grad")?);
    g.kind = d
        .enumeration("Type")
        .map_or(GradientKind::Linear, gradient_kind);
    g.angle = angle(d, "Angl").unwrap_or(90.0);
    g.scale = percent(d, "Scl ").unwrap_or(1.0);
    g.reverse = d.bool("Rvrs").unwrap_or(false);
    g.dither = d.bool("Dthr").unwrap_or(false);
    g.align_with_layer = d.bool("Algn").unwrap_or(true);
    if let Some(offset) = d.object("Ofst") {
        g.offset = (
            percent(offset, "Hrzn").unwrap_or(0.0),
            percent(offset, "Vrtc").unwrap_or(0.0),
        );
    }
    Some(g)
}

/// Writes a gradient and its layout into a descriptor (see [`gradient`]),
/// changing only what differs.
pub(crate) fn put_gradient(d: &mut Descriptor, g: &Gradient) {
    let object = gradient_object_descriptor(g, d.object("Grad"));
    if d.object("Grad") != Some(&object) {
        d.set("Grad", Value::Descriptor(object));
    }
    put_angle(d, "Angl", g.angle);
    put_enum(d, "Type", "GrdT", gradient_kind_id(g.kind));
    put_bool(d, "Rvrs", g.reverse);
    put_bool(d, "Dthr", g.dither);
    put_bool(d, "Algn", g.align_with_layer);
    put_percent(d, "Scl ", g.scale);
    let offset = d.object("Ofst").map(|o| {
        (
            percent(o, "Hrzn").unwrap_or(0.0),
            percent(o, "Vrtc").unwrap_or(0.0),
        )
    });
    if offset != Some(g.offset) {
        d.set(
            "Ofst",
            Value::Descriptor(
                Descriptor::new("Pnt ")
                    .with("Hrzn", percent_value(g.offset.0))
                    .with("Vrtc", percent_value(g.offset.1)),
            ),
        );
    }
}

/// A pattern held in a descriptor: `Ptrn` plus `Scl `, `Angl`, `Algn` (or
/// a fill layer's `Lnkd`), and `phase`.
pub(crate) fn pattern(d: &Descriptor) -> Option<PatternFill> {
    let p = d.object("Ptrn")?;
    let phase = d.object("phase").map_or((0.0, 0.0), |ph| {
        (
            ph.number("Hrzn").unwrap_or(0.0) as f32,
            ph.number("Vrtc").unwrap_or(0.0) as f32,
        )
    });
    Some(PatternFill {
        pattern: p.text("Idnt").unwrap_or_default().to_string(),
        name: p.text("Nm  ").unwrap_or_default().to_string(),
        scale: percent(d, "Scl ").unwrap_or(1.0),
        angle: angle(d, "Angl").unwrap_or(0.0),
        align_with_layer: d.bool("Algn").or_else(|| d.bool("Lnkd")).unwrap_or(true),
        phase,
    })
}

/// Writes a pattern into a descriptor (see [`pattern`]); `align_key` is
/// `Algn` for effects and `Lnkd` for fill layers.
pub(crate) fn put_pattern(d: &mut Descriptor, p: &PatternFill, align_key: &str) {
    let same_ref = d.object("Ptrn").is_some_and(|o| {
        o.text("Idnt") == Some(p.pattern.as_str()) && o.text("Nm  ") == Some(p.name.as_str())
    });
    if !same_ref {
        d.set(
            "Ptrn",
            Value::Descriptor(
                Descriptor::new("Ptrn")
                    .with("Nm  ", Value::Text(p.name.clone()))
                    .with("Idnt", Value::Text(p.pattern.clone())),
            ),
        );
    }
    if d.has("Angl") || p.angle != 0.0 {
        put_angle(d, "Angl", p.angle);
    }
    put_percent(d, "Scl ", p.scale);
    let key = if d.has("Algn") {
        "Algn"
    } else if d.has("Lnkd") {
        "Lnkd"
    } else {
        align_key
    };
    put_bool(d, key, p.align_with_layer);
    let phase = d.object("phase").map(|ph| {
        (
            ph.number("Hrzn").unwrap_or(0.0) as f32,
            ph.number("Vrtc").unwrap_or(0.0) as f32,
        )
    });
    if phase != Some(p.phase) {
        d.set(
            "phase",
            Value::Descriptor(
                Descriptor::new("Pnt ")
                    .with("Hrzn", Value::Double(f64::from(p.phase.0)))
                    .with("Vrtc", Value::Double(f64::from(p.phase.1))),
            ),
        );
    }
}

/// A contour (`ShpC`): points `0..=255` to `0..=1`.
pub(crate) fn contour(d: &Descriptor) -> Contour {
    let points: Vec<(f32, f32)> = d
        .list("Crv ")
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_descriptor)
        .map(|p| {
            (
                (p.number("Hrzn").unwrap_or(0.0) / 255.0) as f32,
                (p.number("Vrtc").unwrap_or(0.0) / 255.0) as f32,
            )
        })
        .collect();
    if points.is_empty() {
        return Contour {
            name: d.text("Nm  ").unwrap_or("Linear").to_string(),
            ..Contour::default()
        };
    }
    Contour {
        name: d.text("Nm  ").unwrap_or_default().to_string(),
        points,
    }
}

/// A contour item, the default when absent.
pub(crate) fn contour_item(d: &Descriptor, key: &str) -> Contour {
    d.object(key).map(contour).unwrap_or_default()
}

/// A contour descriptor (`ShpC`).
pub(crate) fn contour_descriptor(c: &Contour) -> Descriptor {
    let points = c
        .points
        .iter()
        .map(|&(x, y)| {
            Value::Descriptor(
                Descriptor::new("CrPt")
                    .with("Hrzn", Value::Double(f64::from(x) * 255.0))
                    .with("Vrtc", Value::Double(f64::from(y) * 255.0)),
            )
        })
        .collect();
    Descriptor::new("ShpC")
        .with("Nm  ", Value::Text(c.name.clone()))
        .with("Crv ", Value::List(points))
}

/// Sets a contour item unless it already reads as the contour.
pub(crate) fn put_contour(d: &mut Descriptor, key: &str, c: &Contour) {
    if d.object(key).map(contour).as_ref() != Some(c) {
        d.set(key, Value::Descriptor(contour_descriptor(c)));
    }
}

#[cfg(test)]
mod test;
