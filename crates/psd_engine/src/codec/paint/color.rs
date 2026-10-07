//! Colors: descriptor colors (`RGBC` with 8-bit or float components,
//! `HSBC`, `CMYC`, `LbCl`, `Grsc`, book colors) and the binary color
//! structure (a space and four 16-bit components) to straight sRGB, and
//! sRGB back to `RGBC`.

use crate::binary::{Reader, Writer};
use crate::codec::descriptor::{Descriptor, Value};
use crate::error::Result;
use crate::model::Rgb;

fn clamp01(v: f64) -> f32 {
    if v.is_nan() {
        0.0
    } else {
        v.clamp(0.0, 1.0) as f32
    }
}

fn rgb(r: f64, g: f64, b: f64) -> Rgb {
    Rgb::new(clamp01(r), clamp01(g), clamp01(b))
}

/// The sRGB transfer curve, for linear components.
fn encode_srgb(v: f64) -> f64 {
    if v <= 0.003_130_8 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// HSB (hue in degrees, saturation and brightness `0..=1`) to sRGB.
pub(crate) fn hsb_to_rgb(hue: f64, s: f64, v: f64) -> Rgb {
    let h = hue.rem_euclid(360.0) / 60.0;
    let c = v * s;
    let x = c * (1.0 - (h % 2.0 - 1.0).abs());
    let (r, g, b) = match h as u8 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    rgb(r + m, g + m, b + m)
}

/// HSL (hue in degrees, saturation and lightness `0..=1`) to sRGB.
pub(crate) fn hsl_to_rgb(hue: f64, s: f64, l: f64) -> Rgb {
    let v = l + s * l.min(1.0 - l);
    let sv = if v <= 0.0 { 0.0 } else { 2.0 * (1.0 - l / v) };
    hsb_to_rgb(hue, sv, v)
}

/// CMYK ink amounts (`0..=1`) to sRGB, without a profile.
pub(crate) fn cmyk_to_rgb(c: f64, m: f64, y: f64, k: f64) -> Rgb {
    rgb(
        (1.0 - c) * (1.0 - k),
        (1.0 - m) * (1.0 - k),
        (1.0 - y) * (1.0 - k),
    )
}

/// D50 XYZ (white `Y = 1`) to sRGB, through the Bradford-adapted matrix.
pub(crate) fn xyz_to_rgb(x: f64, y: f64, z: f64) -> Rgb {
    let r = 3.133_856_1 * x - 1.616_866_7 * y - 0.490_614_6 * z;
    let g = -0.978_768_4 * x + 1.916_141_5 * y + 0.033_454_0 * z;
    let b = 0.071_945_3 * x - 0.228_991_4 * y + 1.405_242_7 * z;
    rgb(encode_srgb(r), encode_srgb(g), encode_srgb(b))
}

/// CIE L*a*b* (D50; `L` in `0..=100`) to sRGB.
pub(crate) fn lab_to_rgb(l: f64, a: f64, b: f64) -> Rgb {
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let inv = |t: f64| {
        if t > 6.0 / 29.0 {
            t * t * t
        } else {
            3.0 * (6.0f64 / 29.0).powi(2) * (t - 4.0 / 29.0)
        }
    };
    xyz_to_rgb(0.964_22 * inv(fx), inv(fy), 0.825_21 * inv(fz))
}

/// A descriptor color as sRGB, by its class or, failing that, its keys.
/// Book colors carry no components in newer files; they read as black.
pub(crate) fn from_descriptor(d: &Descriptor) -> Rgb {
    let n = |key: &str| d.number(key);
    if let (Some(r), Some(g), Some(b)) = (n("redFloat"), n("greenFloat"), n("blueFloat")) {
        return rgb(r, g, b);
    }
    if let (Some(r), Some(g), Some(b)) = (n("Rd  "), n("Grn "), n("Bl  ")) {
        return rgb(r / 255.0, g / 255.0, b / 255.0);
    }
    if let (Some(h), Some(s), Some(v)) = (n("H   "), n("Strt"), n("Brgh")) {
        let hue = match d.unit("H   ") {
            Some(("#Prc", p)) => p * 3.6,
            _ => h,
        };
        return hsb_to_rgb(hue, s / 100.0, v / 100.0);
    }
    if let (Some(c), Some(m), Some(y), Some(k)) = (n("Cyn "), n("Mgnt"), n("Ylw "), n("Blck")) {
        return cmyk_to_rgb(c / 100.0, m / 100.0, y / 100.0, k / 100.0);
    }
    if let (Some(l), Some(a), Some(b)) = (n("Lmnc"), n("A   "), n("B   ")) {
        return lab_to_rgb(l, a, b);
    }
    if let Some(g) = n("Gry ") {
        let v = 1.0 - g / 100.0;
        return rgb(v, v, v);
    }
    // A book color may nest its components (older files).
    for (_, value) in &d.items {
        if let Some(inner) = value.as_descriptor() {
            return from_descriptor(inner);
        }
    }
    Rgb::BLACK
}

/// An `RGBC` descriptor (8-bit scale components) for a color.
pub(crate) fn to_descriptor(c: Rgb) -> Descriptor {
    Descriptor::new("RGBC")
        .with("Rd  ", Value::Double(f64::from(c.r) * 255.0))
        .with("Grn ", Value::Double(f64::from(c.g) * 255.0))
        .with("Bl  ", Value::Double(f64::from(c.b) * 255.0))
}

/// Reads a binary color: a space and four 16-bit components.
pub(crate) fn read_binary(r: &mut Reader<'_>) -> Result<Rgb> {
    let space = r.u16()?;
    let mut c = [0u16; 4];
    for v in &mut c {
        *v = r.u16()?;
    }
    Ok(from_binary(space, c))
}

/// A binary color as sRGB: RGB (0), HSB (1), CMYK (2, stored inverted),
/// Lab (7), and grayscale (8, as ink); others read as black.
pub(crate) fn from_binary(space: u16, c: [u16; 4]) -> Rgb {
    let unit = |v: u16| f64::from(v) / 65535.0;
    match space {
        0 => rgb(unit(c[0]), unit(c[1]), unit(c[2])),
        1 => hsb_to_rgb(unit(c[0]) * 360.0, unit(c[1]), unit(c[2])),
        2 => cmyk_to_rgb(
            1.0 - unit(c[0]),
            1.0 - unit(c[1]),
            1.0 - unit(c[2]),
            1.0 - unit(c[3]),
        ),
        7 => lab_to_rgb(
            f64::from(c[0]) / 100.0,
            f64::from(c[1] as i16) / 100.0,
            f64::from(c[2] as i16) / 100.0,
        ),
        8 => {
            let v = 1.0 - (f64::from(c[0]) / 10000.0).min(1.0);
            rgb(v, v, v)
        }
        _ => Rgb::BLACK,
    }
}

/// The 16-bit RGB components of a color.
pub(crate) fn to_binary(c: Rgb) -> [u16; 4] {
    let q = |v: f32| (f64::from(v.clamp(0.0, 1.0)) * 65535.0).round() as u16;
    [q(c.r), q(c.g), q(c.b), 0]
}

/// Writes a binary RGB color.
pub(crate) fn write_binary(w: &mut Writer, c: Rgb) {
    w.u16(0);
    for v in to_binary(c) {
        w.u16(v);
    }
}
