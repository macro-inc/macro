//! Artboards (`artb`): an artboard group's rectangle, background, and the
//! guides and preset name the model leaves alone.

use super::descriptor::{self, Descriptor, Value};
use super::paint;
use crate::error::Result;
use crate::model::{Artboard, ArtboardBackground, Rgb};
use crate::raster::IRect;

/// The keys Photoshop has kept a layer's artboard under.
pub const KEYS: [&[u8; 4]; 3] = [b"artb", b"artd", b"abdd"];

/// The background type codes: white, black, transparent, a color.
const WHITE: i32 = 1;
const BLACK: i32 = 2;
const TRANSPARENT: i32 = 3;
const COLOR: i32 = 4;

/// Reads an artboard block.
pub fn decode(data: &[u8]) -> Result<Artboard> {
    let (d, _) = descriptor::read_versioned(data)?;
    Ok(artboard_of(&d))
}

fn artboard_of(d: &Descriptor) -> Artboard {
    let rect = d.object("artboardRect");
    let edge = |key: &str| {
        let v = rect.and_then(|r| r.number(key)).unwrap_or(0.0);
        if v.is_finite() {
            v.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
        } else {
            0
        }
    };
    let (top, left, bottom, right) = (edge("Top "), edge("Left"), edge("Btom"), edge("Rght"));
    let background = match d.number("artboardBackgroundType").map(|v| v as i32) {
        Some(BLACK) => ArtboardBackground::Black,
        Some(TRANSPARENT) => ArtboardBackground::Transparent,
        Some(COLOR) => ArtboardBackground::Color {
            color: paint::color(d, "Clr ").unwrap_or(Rgb::WHITE),
        },
        _ => ArtboardBackground::White,
    };
    Artboard {
        rect: IRect::from_ltrb(left, top, right.max(left), bottom.max(top)),
        background,
    }
}

/// Writes an artboard block, starting from the `original` (keeping its
/// guides, preset name, and stored color) when there is one.
pub fn encode(a: &Artboard, original: Option<&[u8]>) -> Vec<u8> {
    let parsed = original.and_then(|o| Some((o, descriptor::read_versioned(o).ok()?)));
    if let Some((o, (d, used))) = &parsed
        && artboard_of(d) == *a
    {
        return o[..*used].to_vec();
    }
    let mut d = parsed.map_or_else(fresh, |(_, (d, _))| d);
    let r = a.rect;
    d.set(
        "artboardRect",
        Value::Descriptor(
            Descriptor::new("classFloatRect")
                .with("Top ", Value::Double(f64::from(r.y)))
                .with("Left", Value::Double(f64::from(r.x)))
                .with("Btom", Value::Double(f64::from(r.bottom())))
                .with("Rght", Value::Double(f64::from(r.right()))),
        ),
    );
    let code = match a.background {
        ArtboardBackground::White => WHITE,
        ArtboardBackground::Black => BLACK,
        ArtboardBackground::Transparent => TRANSPARENT,
        ArtboardBackground::Color { color } => {
            paint::put_color(&mut d, "Clr ", color);
            COLOR
        }
    };
    d.set("artboardBackgroundType", Value::Integer(code));
    descriptor::write_versioned(&d)
}

/// A new artboard descriptor, items in Photoshop's order.
fn fresh() -> Descriptor {
    let mut d = Descriptor::new("artboard")
        .with("artboardRect", Value::Bool(false))
        .with("guideIndeces", Value::List(Vec::new()))
        .with("artboardPresetName", Value::Text(String::new()))
        .with("Clr ", Value::Bool(false))
        .with("artboardBackgroundType", Value::Integer(WHITE));
    paint::put_color(&mut d, "Clr ", Rgb::WHITE);
    d
}

#[cfg(test)]
mod test;
