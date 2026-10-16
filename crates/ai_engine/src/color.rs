//! Color spaces: device gray, RGB, and CMYK, calibrated spaces, Lab,
//! ICC-based (by component count, or its alternate), indexed, separations
//! and DeviceN (through their tint transforms), and patterns; converted to
//! straight sRGB.
//!
//! ICC profiles themselves are not read: an ICC-based space is drawn
//! through its alternate (or the device space with its component count),
//! CMYK through a fit of a SWOP press profile, and the calibrated spaces
//! by their gammas. `Default*` color spaces in resources are not applied
//! (they are ICC spaces of the same component count).

mod convert;
mod sample;

pub use sample::SampleConverter;

/// `0..=1` to a byte, rounding (`NaN` to 0).
pub(crate) use convert::to_u8;

use crate::error::{AiError, Result};
use crate::function::Function;
use crate::function::read::{clamp, dict_numbers, get, number};
use crate::pdf::{Dict, Name, Object, Resolve};
use convert::{D50, cmyk_to_rgb, lab_to_xyz, srgb_encode, xyz_to_linear_srgb, xyz_to_srgb};

/// Color spaces nested in color spaces (bases, alternates, resource names).
const MAX_DEPTH: usize = 8;
/// The highest index an indexed space may have.
const MAX_HIVAL: u32 = 4095;

/// A color space.
#[derive(Clone, Debug, PartialEq)]
pub enum ColorSpace {
    /// `DeviceGray`.
    Gray,
    /// `DeviceRGB`.
    Rgb,
    /// `DeviceCMYK`.
    Cmyk,
    /// `CalGray`, drawn as gray with its gamma.
    CalGray {
        /// Gamma.
        gamma: f32,
    },
    /// `CalRGB`, drawn as RGB with its gammas.
    CalRgb {
        /// Gamma per component.
        gamma: [f32; 3],
    },
    /// `Lab`.
    Lab {
        /// White point.
        white: [f32; 3],
        /// `a` and `b` ranges.
        range: [f32; 4],
    },
    /// `ICCBased`: drawn by component count (gray, RGB, CMYK) or its
    /// alternate.
    Icc {
        /// Components.
        n: usize,
        /// The alternate space.
        alternate: Box<ColorSpace>,
    },
    /// `Indexed`.
    Indexed {
        /// The base space.
        base: Box<ColorSpace>,
        /// The highest index.
        hival: u32,
        /// The lookup table (`(hival + 1) × base components` bytes).
        lookup: Vec<u8>,
    },
    /// `Separation`.
    Separation {
        /// The colorant (`All`, `None`, or an ink).
        name: String,
        /// The alternate space.
        alternate: Box<ColorSpace>,
        /// Tint to alternate components.
        tint: Function,
    },
    /// `DeviceN`.
    DeviceN {
        /// Colorants.
        names: Vec<String>,
        /// The alternate space.
        alternate: Box<ColorSpace>,
        /// Tints to alternate components.
        tint: Function,
    },
    /// `Pattern`, with the space of an uncolored pattern's color.
    Pattern(Option<Box<ColorSpace>>),
}

fn corrupt(what: &str) -> AiError {
    AiError::corrupt(format!("color space: {what}"))
}

/// A device space by its name (inline-image abbreviations included).
fn device(name: &[u8]) -> Option<ColorSpace> {
    Some(match name {
        b"DeviceGray" | b"G" | b"CalGray" => ColorSpace::Gray,
        b"DeviceRGB" | b"RGB" | b"CalRGB" => ColorSpace::Rgb,
        b"DeviceCMYK" | b"CMYK" => ColorSpace::Cmyk,
        b"Pattern" => ColorSpace::Pattern(None),
        _ => return None,
    })
}

/// A dictionary's value for a key given as a name's bytes.
fn lookup<'a>(dict: &'a Dict, key: &Name) -> Option<&'a Object> {
    dict.iter().find(|(k, _)| *k == key).map(|(_, v)| v)
}

impl ColorSpace {
    /// Reads a color space: a name (device spaces, or a key of the
    /// resources' `ColorSpace` dictionary) or an array.
    pub fn parse(pdf: &dyn Resolve, value: &Object, resources: &Dict) -> Result<ColorSpace> {
        parse(pdf, value, resources, 0)
    }

    /// Components a color in this space has (for `Pattern`, those of an
    /// uncolored pattern's color: none for colored patterns).
    pub fn components(&self) -> usize {
        match self {
            ColorSpace::Gray
            | ColorSpace::CalGray { .. }
            | ColorSpace::Indexed { .. }
            | ColorSpace::Separation { .. } => 1,
            ColorSpace::Rgb | ColorSpace::CalRgb { .. } | ColorSpace::Lab { .. } => 3,
            ColorSpace::Cmyk => 4,
            ColorSpace::Icc { n, .. } => *n,
            ColorSpace::DeviceN { names, .. } => names.len(),
            ColorSpace::Pattern(base) => base.as_ref().map_or(0, |b| b.components()),
        }
    }

    /// The initial color: `0` in most spaces (clamped into the ranges),
    /// black (`0 0 0 1`) in `DeviceCMYK`, and `1` (full tint) for
    /// separations and DeviceN.
    pub fn initial(&self) -> Vec<f32> {
        match self {
            ColorSpace::Cmyk => vec![0.0, 0.0, 0.0, 1.0],
            ColorSpace::Separation { .. } | ColorSpace::DeviceN { .. } => {
                vec![1.0; self.components()]
            }
            _ => self
                .ranges()
                .iter()
                .map(|&[lo, hi]| clamp(0.0, lo, hi))
                .collect(),
        }
    }

    /// The interval each component takes: `0..=1` in most spaces, `0..=100`
    /// for L* and the `Range` for a* and b* in Lab, and `0..=hival` for an
    /// indexed space's index.
    pub fn ranges(&self) -> Vec<[f32; 2]> {
        match self {
            ColorSpace::Lab { range, .. } => {
                vec![[0.0, 100.0], [range[0], range[1]], [range[2], range[3]]]
            }
            ColorSpace::Icc { n, alternate } if alternate.components() == *n => alternate.ranges(),
            ColorSpace::Indexed { hival, .. } => vec![[0.0, *hival as f32]],
            ColorSpace::Pattern(Some(base)) => base.ranges(),
            _ => vec![[0.0, 1.0]; self.components()],
        }
    }

    /// Whether painting in this space leaves no mark: a `None` separation,
    /// a DeviceN space of only `None` colorants, or an indexed space over
    /// one. Painting operators should skip such colors.
    pub fn is_invisible(&self) -> bool {
        match self {
            ColorSpace::Separation { name, .. } => name == "None",
            ColorSpace::DeviceN { names, .. } => {
                !names.is_empty() && names.iter().all(|n| n == "None")
            }
            ColorSpace::Indexed { base, .. } => base.is_invisible(),
            _ => false,
        }
    }

    /// A color's straight sRGB, `0..=1`.
    pub fn to_rgb(&self, components: &[f32]) -> [f32; 3] {
        let c = |i: usize| components.get(i).copied().unwrap_or(0.0);
        match self {
            ColorSpace::Gray => {
                let g = clamp(c(0), 0.0, 1.0);
                [g, g, g]
            }
            ColorSpace::Rgb => [c(0), c(1), c(2)].map(|v| clamp(v, 0.0, 1.0)),
            ColorSpace::Cmyk => cmyk_to_rgb(c(0), c(1), c(2), c(3)),
            ColorSpace::CalGray { gamma } => {
                let g = srgb_encode(clamp(c(0), 0.0, 1.0).powf(*gamma));
                [g, g, g]
            }
            ColorSpace::CalRgb { gamma } => {
                [0, 1, 2].map(|i| srgb_encode(clamp(c(i), 0.0, 1.0).powf(gamma[i])))
            }
            ColorSpace::Lab { white, range } => {
                let l = clamp(c(0), 0.0, 100.0);
                let a = clamp(c(1), range[0], range[1]);
                let b = clamp(c(2), range[2], range[3]);
                xyz_to_srgb(&xyz_to_linear_srgb(*white), lab_to_xyz(l, a, b, *white))
            }
            ColorSpace::Icc { alternate, .. } => alternate.to_rgb(components),
            ColorSpace::Indexed {
                base,
                hival,
                lookup,
            } => {
                let mut values = [0.0f32; crate::function::MAX_ARITY];
                let stride = base.components();
                let n = stride.min(values.len());
                let index = clamp(c(0).round(), 0.0, *hival as f32) as usize;
                let ranges = base.ranges();
                for (i, v) in values[..n].iter_mut().enumerate() {
                    let byte = lookup.get(index * stride + i).copied().unwrap_or(0);
                    let [lo, hi] = ranges.get(i).copied().unwrap_or([0.0, 1.0]);
                    *v = lo + f32::from(byte) / 255.0 * (hi - lo);
                }
                base.to_rgb(&values[..n])
            }
            ColorSpace::Separation {
                name,
                alternate,
                tint,
            } => match name.as_str() {
                "None" => [1.0; 3],
                "All" => {
                    let g = 1.0 - clamp(c(0), 0.0, 1.0);
                    [g, g, g]
                }
                _ => through_tint(tint, alternate, components),
            },
            ColorSpace::DeviceN {
                alternate, tint, ..
            } => {
                if self.is_invisible() {
                    [1.0; 3]
                } else {
                    through_tint(tint, alternate, components)
                }
            }
            ColorSpace::Pattern(base) => base.as_ref().map_or([0.0; 3], |b| b.to_rgb(components)),
        }
    }

    /// Converts colors in bulk: `components` holds colors of
    /// [`ColorSpace::components`] values each, written as sRGB8 to `out`,
    /// one every `stride` bytes (`3` for RGB, `4` to fill RGBA pixels and
    /// leave their alpha).
    pub fn rgb_row(&self, components: &[f32], out: &mut [u8], stride: usize) {
        let n = self.components();
        if n == 0 {
            return;
        }
        let stride = stride.max(3);
        let pixels = components
            .chunks_exact(n)
            .zip(out.chunks_mut(stride).filter(|p| p.len() >= 3));
        match self {
            ColorSpace::Gray => {
                for (c, px) in pixels {
                    px[..3].fill(to_u8(c[0]));
                }
            }
            ColorSpace::Rgb => {
                for (c, px) in pixels {
                    px[0] = to_u8(c[0]);
                    px[1] = to_u8(c[1]);
                    px[2] = to_u8(c[2]);
                }
            }
            _ => {
                let mut last: Option<(&[f32], [u8; 3])> = None;
                for (c, px) in pixels {
                    let rgb = match last {
                        Some((prev, rgb)) if prev == c => rgb,
                        _ => self.to_rgb(c).map(to_u8),
                    };
                    px[..3].copy_from_slice(&rgb);
                    last = Some((c, rgb));
                }
            }
        }
    }
}

/// A separation or DeviceN color through its tint transform.
fn through_tint(tint: &Function, alternate: &ColorSpace, components: &[f32]) -> [f32; 3] {
    let mut values = [0.0f32; crate::function::MAX_ARITY];
    tint.eval_into(components, &mut values);
    let n = alternate.components().min(values.len());
    alternate.to_rgb(&values[..n])
}

fn parse(pdf: &dyn Resolve, value: &Object, resources: &Dict, depth: usize) -> Result<ColorSpace> {
    if depth > MAX_DEPTH {
        return Err(corrupt("nested too deeply"));
    }
    match pdf.resolve(value) {
        Object::Name(name) => {
            if let Some(cs) = device(name.as_bytes()) {
                return Ok(cs);
            }
            let spaces = get(pdf, resources, "ColorSpace");
            let def = spaces
                .as_dict()
                .and_then(|d| lookup(d, &name))
                .ok_or_else(|| corrupt(&format!("unknown name {name:?}")))?;
            parse(pdf, def, resources, depth + 1)
        }
        Object::Array(items) => parse_array(pdf, &items, resources, depth),
        // A bare ICC profile stream, as some writers give.
        stream @ Object::Stream(_) => icc(pdf, &stream, resources, depth),
        _ => Err(corrupt("not a name or array")),
    }
}

fn parse_array(
    pdf: &dyn Resolve,
    items: &[Object],
    resources: &Dict,
    depth: usize,
) -> Result<ColorSpace> {
    let family = items.first().map(|f| pdf.resolve(f));
    let family = family
        .as_ref()
        .and_then(Object::as_name)
        .ok_or_else(|| corrupt("array without a family name"))?;
    let param = |i: usize| items.get(i).map(|o| pdf.resolve(o)).unwrap_or_default();
    let params = param(1);
    let params = params.as_dict().cloned().unwrap_or_default();
    match family.as_bytes() {
        b"CalGray" => {
            let gamma = crate::function::read::dict_number(pdf, &params, "Gamma")
                .filter(|g| g.is_finite() && *g > 0.0)
                .unwrap_or(1.0);
            Ok(ColorSpace::CalGray { gamma })
        }
        b"CalRGB" => {
            let gamma = dict_numbers(pdf, &params, "Gamma")
                .filter(|g| g.len() == 3 && g.iter().all(|v| *v > 0.0))
                .map_or([1.0; 3], |g| [g[0], g[1], g[2]]);
            Ok(ColorSpace::CalRgb { gamma })
        }
        b"Lab" => {
            let white = dict_numbers(pdf, &params, "WhitePoint")
                .filter(|w| w.len() == 3 && w.iter().all(|v| *v > 0.0))
                .map_or(D50, |w| [w[0], w[1], w[2]]);
            let range = dict_numbers(pdf, &params, "Range")
                .filter(|r| r.len() == 4)
                .map_or([-100.0, 100.0, -100.0, 100.0], |r| [r[0], r[1], r[2], r[3]]);
            Ok(ColorSpace::Lab { white, range })
        }
        b"ICCBased" => icc(pdf, &param(1), resources, depth),
        b"Indexed" | b"I" => {
            let base = parse(
                pdf,
                items.get(1).unwrap_or(&Object::Null),
                resources,
                depth + 1,
            )?;
            if matches!(base, ColorSpace::Indexed { .. } | ColorSpace::Pattern(_)) {
                return Err(corrupt("indexed over an indexed or pattern space"));
            }
            let hival = number(pdf, &param(2))
                .filter(|h| h.is_finite())
                .ok_or_else(|| corrupt("indexed without hival"))?
                .clamp(0.0, MAX_HIVAL as f32) as u32;
            let mut lookup = match param(3) {
                Object::String(bytes) => bytes,
                Object::Stream(s) => pdf.stream_data(&s)?,
                _ => return Err(corrupt("indexed without a lookup table")),
            };
            // Short tables read as zeros; extra bytes are dropped.
            lookup.resize((hival as usize + 1) * base.components(), 0);
            Ok(ColorSpace::Indexed {
                base: Box::new(base),
                hival,
                lookup,
            })
        }
        b"Separation" => {
            let name = param(1)
                .as_name()
                .map(|n| n.as_str().into_owned())
                .ok_or_else(|| corrupt("separation without a colorant"))?;
            let alternate = parse(
                pdf,
                items.get(2).unwrap_or(&Object::Null),
                resources,
                depth + 1,
            )?;
            let tint = Function::parse(pdf, items.get(3).unwrap_or(&Object::Null))?;
            Ok(ColorSpace::Separation {
                name,
                alternate: Box::new(alternate),
                tint,
            })
        }
        b"DeviceN" => {
            let names = param(1)
                .as_array()
                .ok_or_else(|| corrupt("DeviceN without colorants"))?
                .iter()
                .map(|n| pdf.resolve(n).as_name().map(|n| n.as_str().into_owned()))
                .collect::<Option<Vec<String>>>()
                .filter(|n| !n.is_empty() && n.len() <= crate::function::MAX_ARITY)
                .ok_or_else(|| corrupt("bad DeviceN colorants"))?;
            let alternate = parse(
                pdf,
                items.get(2).unwrap_or(&Object::Null),
                resources,
                depth + 1,
            )?;
            let tint = Function::parse(pdf, items.get(3).unwrap_or(&Object::Null))?;
            Ok(ColorSpace::DeviceN {
                names,
                alternate: Box::new(alternate),
                tint,
            })
        }
        b"Pattern" => {
            let base = match items.get(1) {
                Some(b) => Some(Box::new(parse(pdf, b, resources, depth + 1)?)),
                None => None,
            };
            Ok(ColorSpace::Pattern(base))
        }
        name if items.len() == 1 => {
            // `[/DeviceRGB]` and other single names.
            parse(
                pdf,
                &Object::Name(Name(name.to_vec())),
                resources,
                depth + 1,
            )
        }
        _ => Err(corrupt(&format!("unknown family {family:?}"))),
    }
}

/// An `ICCBased` space from its profile stream: `N` components, drawn
/// through `Alternate` when it agrees, else the device space for `N`.
fn icc(pdf: &dyn Resolve, profile: &Object, resources: &Dict, depth: usize) -> Result<ColorSpace> {
    let dict = profile
        .as_dict()
        .ok_or_else(|| corrupt("ICCBased without a profile"))?;
    let alternate = dict
        .get("Alternate")
        .and_then(|a| parse(pdf, a, resources, depth + 1).ok())
        .filter(|a| !matches!(a, ColorSpace::Pattern(_) | ColorSpace::Indexed { .. }));
    let n = crate::function::read::dict_int(pdf, dict, "N")
        .and_then(|n| usize::try_from(n).ok())
        .filter(|n| (1..=4).contains(n))
        .or_else(|| alternate.as_ref().map(ColorSpace::components))
        .ok_or_else(|| corrupt("ICCBased without N"))?;
    let alternate = match alternate.filter(|a| a.components() == n) {
        Some(a) => a,
        None => match n {
            1 => ColorSpace::Gray,
            3 => ColorSpace::Rgb,
            4 => ColorSpace::Cmyk,
            _ => return Err(corrupt("ICCBased without a usable alternate")),
        },
    };
    Ok(ColorSpace::Icc {
        n,
        alternate: Box::new(alternate),
    })
}

#[cfg(test)]
mod test;
