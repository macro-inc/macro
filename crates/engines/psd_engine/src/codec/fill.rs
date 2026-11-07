//! Fill layers (`SoCo` solid color, `GdFl` gradient, `PtFl` pattern) and
//! shape strokes (`vstk`).
//!
//! Each fill block is a descriptor (after its version, 16). Newer shape
//! layers keep their fill in `vscg` instead: the fill's key, then the same
//! descriptor. Encoders change only the items that differ from the model,
//! so unchanged values keep their stored form.

use crate::binary::Writer;
use crate::codec::descriptor::{self, Descriptor, Value};
use crate::codec::paint;
use crate::error::{PsdError, Result};
use crate::model::{BlendMode, Fill, LineCap, LineJoin, Rgb, StrokeAlign, VectorStroke};

/// Keys of the fill layer blocks (`vscg` holds a shape layer's fill in
/// newer files).
pub const KEYS: [[u8; 4]; 4] = [*b"SoCo", *b"GdFl", *b"PtFl", *b"vscg"];

/// The key of a fill's own block.
fn kind_key(fill: &Fill) -> [u8; 4] {
    match fill {
        Fill::Solid { .. } => *b"SoCo",
        Fill::Gradient { .. } => *b"GdFl",
        Fill::Pattern { .. } => *b"PtFl",
    }
}

/// A fill block's kind key and descriptor, and how many bytes they took.
fn read_block(key: &[u8; 4], data: &[u8]) -> Result<([u8; 4], Descriptor, usize)> {
    if key == b"vscg" {
        let inner: [u8; 4] = data
            .get(..4)
            .and_then(|k| k.try_into().ok())
            .ok_or_else(|| PsdError::corrupt("vscg without a key"))?;
        let (d, used) = descriptor::read_versioned(&data[4..])?;
        Ok((inner, d, 4 + used))
    } else {
        let (d, used) = descriptor::read_versioned(data)?;
        Ok((*key, d, used))
    }
}

/// The fill a descriptor holds: by its kind key, else by its items.
pub(crate) fn fill_of(kind: &[u8; 4], d: &Descriptor) -> Result<Fill> {
    let kind = match kind {
        b"SoCo" | b"GdFl" | b"PtFl" => *kind,
        _ if d.has("Grad") => *b"GdFl",
        _ if d.has("Ptrn") => *b"PtFl",
        _ => *b"SoCo",
    };
    Ok(match &kind {
        b"GdFl" => Fill::Gradient {
            gradient: paint::gradient(d)
                .ok_or_else(|| PsdError::corrupt("gradient fill without a gradient"))?,
        },
        b"PtFl" => Fill::Pattern {
            pattern: paint::pattern(d)
                .ok_or_else(|| PsdError::corrupt("pattern fill without a pattern"))?,
        },
        _ => Fill::Solid {
            color: paint::color(d, "Clr ").unwrap_or(Rgb::BLACK),
        },
    })
}

/// Writes a fill into a descriptor of its kind, changing only what
/// differs (`align_key` is the pattern alignment item's key).
pub(crate) fn put_fill(d: &mut Descriptor, fill: &Fill, align_key: &str) {
    match fill {
        Fill::Solid { color } => paint::put_color(d, "Clr ", *color),
        Fill::Gradient { gradient } => paint::put_gradient(d, gradient),
        Fill::Pattern { pattern } => paint::put_pattern(d, pattern, align_key),
    }
}

/// A new fill descriptor, items in Photoshop's order.
pub(crate) fn new_fill(fill: &Fill, class: &str, align_key: &str) -> Descriptor {
    let mut d = Descriptor::new(class);
    if let Fill::Gradient { .. } = fill {
        for key in [
            "Dthr",
            "gradientsInterpolationMethod",
            "Rvrs",
            "Angl",
            "Type",
            "Algn",
            "Scl ",
            "Ofst",
            "Grad",
        ] {
            d.items.push((key.into(), Value::Bool(false)));
        }
    }
    put_fill(&mut d, fill, align_key);
    d
}

/// Reads a fill layer block (`SoCo`, `GdFl`, `PtFl`, or `vscg`).
pub fn decode(key: &[u8; 4], data: &[u8]) -> Result<Fill> {
    let (kind, d, _) = read_block(key, data)?;
    fill_of(&kind, &d)
}

/// Writes a fill layer block: its key and data, starting from the
/// `original` block of the same key when there is one. A `vscg` original
/// gives a `vscg` block; otherwise the key is the fill's own, which differs
/// from the original's when the fill changed kind (the original block is
/// then replaced).
pub fn encode(fill: &Fill, original: Option<(&[u8; 4], &[u8])>) -> ([u8; 4], Vec<u8>) {
    let kind = kind_key(fill);
    let parsed = original.and_then(|(key, data)| Some((*key, data, read_block(key, data).ok()?)));
    let Some((key, data, (inner, mut d, used))) = parsed else {
        return (
            kind,
            descriptor::write_versioned(&new_fill(fill, "null", "Lnkd")),
        );
    };
    if fill_of(&inner, &d).ok().as_ref() == Some(fill) {
        return (key, data[..used].to_vec());
    }
    if inner == kind {
        put_fill(&mut d, fill, "Lnkd");
    } else {
        d = new_fill(fill, "null", "Lnkd");
    }
    if key == *b"vscg" {
        let mut w = Writer::new();
        w.sig(&kind);
        w.bytes(&descriptor::write_versioned(&d));
        (key, w.into_bytes())
    } else {
        (kind, descriptor::write_versioned(&d))
    }
}

const CAPS: [(LineCap, &str); 3] = [
    (LineCap::Butt, "strokeStyleButtCap"),
    (LineCap::Round, "strokeStyleRoundCap"),
    (LineCap::Square, "strokeStyleSquareCap"),
];

const JOINS: [(LineJoin, &str); 3] = [
    (LineJoin::Miter, "strokeStyleMiterJoin"),
    (LineJoin::Round, "strokeStyleRoundJoin"),
    (LineJoin::Bevel, "strokeStyleBevelJoin"),
];

const ALIGNS: [(StrokeAlign, &str); 3] = [
    (StrokeAlign::Inside, "strokeStyleAlignInside"),
    (StrokeAlign::Center, "strokeStyleAlignCenter"),
    (StrokeAlign::Outside, "strokeStyleAlignOutside"),
];

fn lookup<T: Copy + PartialEq>(table: &[(T, &'static str)], id: Option<&str>, default: T) -> T {
    id.and_then(|id| table.iter().find(|(_, s)| *s == id))
        .map_or(default, |(v, _)| *v)
}

fn id_of<T: Copy + PartialEq>(table: &[(T, &'static str)], value: T) -> &'static str {
    table
        .iter()
        .find(|(v, _)| *v == value)
        .map_or(table[0].1, |(_, s)| s)
}

/// The stroke's resolution, for widths stored in points.
fn resolution(d: &Descriptor) -> f64 {
    d.number("strokeStyleResolution")
        .filter(|r| *r > 0.0)
        .unwrap_or(72.0)
}

fn width_of(d: &Descriptor) -> f32 {
    d.unit("strokeStyleLineWidth").map_or(1.0, |(unit, v)| {
        paint::length_to_pixels(unit, v, resolution(d)) as f32
    })
}

fn content_kind(d: &Descriptor) -> [u8; 4] {
    match d.class.as_str() {
        "gradientLayer" => *b"GdFl",
        "patternLayer" => *b"PtFl",
        "solidColorLayer" => *b"SoCo",
        _ => *b"    ",
    }
}

fn stroke_of(d: &Descriptor) -> VectorStroke {
    let fill = d
        .object("strokeStyleContent")
        .and_then(|c| fill_of(&content_kind(c), c).ok())
        .unwrap_or(Fill::Solid { color: Rgb::BLACK });
    VectorStroke {
        enabled: d.bool("strokeEnabled").unwrap_or(true),
        fill_enabled: d.bool("fillEnabled").unwrap_or(true),
        width: width_of(d),
        align: lookup(
            &ALIGNS,
            d.enumeration("strokeStyleLineAlignment"),
            StrokeAlign::Center,
        ),
        cap: lookup(
            &CAPS,
            d.enumeration("strokeStyleLineCapType"),
            LineCap::Butt,
        ),
        join: lookup(
            &JOINS,
            d.enumeration("strokeStyleLineJoinType"),
            LineJoin::Miter,
        ),
        miter_limit: d.number("strokeStyleMiterLimit").unwrap_or(100.0) as f32,
        dashes: d
            .list("strokeStyleLineDashSet")
            .unwrap_or_default()
            .iter()
            .filter_map(Value::as_number)
            .map(|v| v as f32)
            .collect(),
        dash_offset: d.number("strokeStyleLineDashOffset").unwrap_or(0.0) as f32,
        opacity: paint::percent(d, "strokeStyleOpacity").unwrap_or(1.0),
        blend: paint::blend(d, "strokeStyleBlendMode").unwrap_or(BlendMode::Normal),
        fill,
    }
}

/// Reads a `vstk` block.
pub fn decode_stroke(data: &[u8]) -> Result<VectorStroke> {
    let (d, _) = descriptor::read_versioned(data)?;
    Ok(stroke_of(&d))
}

/// A new stroke descriptor with Photoshop's items, in its order.
fn new_stroke() -> Descriptor {
    let enum_value = paint::enum_value;
    Descriptor::new("strokeStyle")
        .with("strokeStyleVersion", Value::Integer(2))
        .with("strokeEnabled", Value::Bool(true))
        .with("fillEnabled", Value::Bool(true))
        .with("strokeStyleLineWidth", paint::pixels_value(1.0))
        .with(
            "strokeStyleLineDashOffset",
            Value::UnitDouble("#Pnt".into(), 0.0),
        )
        .with("strokeStyleMiterLimit", Value::Double(100.0))
        .with(
            "strokeStyleLineCapType",
            enum_value("strokeStyleLineCapType", "strokeStyleButtCap"),
        )
        .with(
            "strokeStyleLineJoinType",
            enum_value("strokeStyleLineJoinType", "strokeStyleMiterJoin"),
        )
        .with(
            "strokeStyleLineAlignment",
            enum_value("strokeStyleLineAlignment", "strokeStyleAlignCenter"),
        )
        .with("strokeStyleScaleLock", Value::Bool(false))
        .with("strokeStyleStrokeAdjust", Value::Bool(false))
        .with("strokeStyleLineDashSet", Value::List(Vec::new()))
        .with(
            "strokeStyleBlendMode",
            paint::blend_value(BlendMode::Normal),
        )
        .with("strokeStyleOpacity", paint::percent_value(1.0))
        .with(
            "strokeStyleContent",
            Value::Descriptor(new_fill(
                &Fill::Solid { color: Rgb::BLACK },
                "solidColorLayer",
                "Lnkd",
            )),
        )
        .with("strokeStyleResolution", Value::Double(72.0))
}

/// Writes a `vstk` block, starting from the `original` when there is one.
pub fn encode_stroke(stroke: &VectorStroke, original: Option<&[u8]>) -> Vec<u8> {
    let parsed = original.and_then(|data| Some((data, descriptor::read_versioned(data).ok()?)));
    let mut d = match parsed {
        Some((data, (d, used))) if stroke_of(&d) == *stroke => return data[..used].to_vec(),
        Some((_, (d, _))) => d,
        None => new_stroke(),
    };
    paint::put_bool(&mut d, "strokeEnabled", stroke.enabled);
    paint::put_bool(&mut d, "fillEnabled", stroke.fill_enabled);
    if width_of(&d) != stroke.width {
        let points = d
            .unit("strokeStyleLineWidth")
            .is_some_and(|(u, _)| u == "#Pnt");
        let value = if points {
            Value::UnitDouble(
                "#Pnt".into(),
                f64::from(stroke.width) * 72.0 / resolution(&d),
            )
        } else {
            paint::pixels_value(stroke.width)
        };
        d.set("strokeStyleLineWidth", value);
    }
    let put_id = |d: &mut Descriptor, key: &str, id: &str| paint::put_enum(d, key, key, id);
    put_id(
        &mut d,
        "strokeStyleLineAlignment",
        id_of(&ALIGNS, stroke.align),
    );
    put_id(&mut d, "strokeStyleLineCapType", id_of(&CAPS, stroke.cap));
    put_id(
        &mut d,
        "strokeStyleLineJoinType",
        id_of(&JOINS, stroke.join),
    );
    if d.number("strokeStyleMiterLimit").map(|v| v as f32) != Some(stroke.miter_limit) {
        d.set(
            "strokeStyleMiterLimit",
            Value::Double(f64::from(stroke.miter_limit)),
        );
    }
    let dashes: Vec<f32> = d
        .list("strokeStyleLineDashSet")
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_number)
        .map(|v| v as f32)
        .collect();
    if dashes != stroke.dashes {
        let list = stroke
            .dashes
            .iter()
            .map(|&v| Value::UnitDouble("#Nne".into(), f64::from(v)))
            .collect();
        d.set("strokeStyleLineDashSet", Value::List(list));
    }
    if d.number("strokeStyleLineDashOffset").map(|v| v as f32) != Some(stroke.dash_offset) {
        let unit = d
            .unit("strokeStyleLineDashOffset")
            .map_or("#Pnt", |(u, _)| u)
            .to_string();
        d.set(
            "strokeStyleLineDashOffset",
            Value::UnitDouble(unit, f64::from(stroke.dash_offset)),
        );
    }
    paint::put_percent(&mut d, "strokeStyleOpacity", stroke.opacity);
    paint::put_blend(&mut d, "strokeStyleBlendMode", stroke.blend);
    let kind = kind_key(&stroke.fill);
    let content = match d.object("strokeStyleContent") {
        Some(c) if content_kind(c) == kind => {
            let mut c = c.clone();
            put_fill(&mut c, &stroke.fill, "Lnkd");
            c
        }
        _ => {
            let class = match &kind {
                b"GdFl" => "gradientLayer",
                b"PtFl" => "patternLayer",
                _ => "solidColorLayer",
            };
            new_fill(&stroke.fill, class, "Lnkd")
        }
    };
    if d.object("strokeStyleContent") != Some(&content) {
        d.set("strokeStyleContent", Value::Descriptor(content));
    }
    descriptor::write_versioned(&d)
}

#[cfg(test)]
mod test;
