//! Image samples to sRGB8 in bulk.

use super::ColorSpace;
use super::convert::{cmyk_to_rgb, lab_to_xyz, to_u8, xyz_to_linear_srgb, xyz_to_srgb_u8};
use crate::function::read::clamp;

/// Converts image samples (integers of 1 to 16 bits, one per component)
/// to sRGB8 through a `Decode` mapping onto the space's components.
///
/// When one sample decides the color (one-component spaces, indexed spaces
/// included) every sample value is converted once into a table, as is
/// every value of each channel of RGB; other spaces convert per pixel,
/// reusing the last result through runs of one color. 16-bit samples go
/// through the tables by their high byte.
pub struct SampleConverter<'a> {
    space: &'a ColorSpace,
    /// The space without ICC wrappers.
    plain: &'a ColorSpace,
    bits: u32,
    /// Per component: the value of sample 0 and the step per sample unit.
    decode: Vec<(f32, f32)>,
    /// sRGB of every sample value (one-component spaces).
    table: Option<Vec<[u8; 3]>>,
    /// Each RGB channel's byte for every sample value.
    channels: Option<[Vec<u8>; 3]>,
    lab: Option<Lab>,
    values: Vec<f32>,
    last: Option<(Vec<u16>, [u8; 3])>,
}

/// What converting Lab needs: the white point, its matrix to linear sRGB,
/// and the a* b* ranges.
#[derive(Clone, Copy)]
struct Lab {
    white: [f32; 3],
    matrix: [[f32; 3]; 3],
    range: [f32; 4],
}

/// An ICC-based space's alternate (when it has the same components),
/// through any nesting.
fn plain(space: &ColorSpace) -> &ColorSpace {
    match space {
        ColorSpace::Icc { n, alternate } if alternate.components() == *n => plain(alternate),
        _ => space,
    }
}

impl<'a> SampleConverter<'a> {
    /// A converter for samples of `bits` bits in `space`, decoded by
    /// `decode` (`[min max]` per component; the space's default when
    /// `None` or too short: its ranges, or `0..2^bits-1` for indexes).
    pub fn new(space: &'a ColorSpace, bits: u8, decode: Option<&[f32]>) -> SampleConverter<'a> {
        let bits = u32::from(bits.clamp(1, 16));
        let n = space.components();
        let max = ((1u32 << bits) - 1) as f32;
        let default = match space {
            ColorSpace::Indexed { .. } => vec![[0.0, max]],
            _ => space.ranges(),
        };
        let pairs: Vec<[f32; 2]> = match decode {
            Some(d) if d.len() >= 2 * n => {
                d.chunks_exact(2).take(n).map(|p| [p[0], p[1]]).collect()
            }
            _ => default,
        };
        let decode: Vec<(f32, f32)> = pairs
            .iter()
            .map(|&[lo, hi]| (lo, (hi - lo) / max))
            .collect();
        let plain = plain(space);
        let lab = match plain {
            ColorSpace::Lab { white, range } => Some(Lab {
                white: *white,
                matrix: xyz_to_linear_srgb(*white),
                range: *range,
            }),
            _ => None,
        };
        // Table entries: every sample value, or every high byte.
        let entries = 1u32 << bits.min(8);
        let sample = |s: u32| if bits > 8 { s * 257 } else { s } as f32;
        let channels = matches!(plain, ColorSpace::Rgb).then(|| {
            [0, 1, 2].map(|c| {
                let (lo, step) = decode[c];
                (0..entries)
                    .map(|s| to_u8(lo + sample(s) * step))
                    .collect::<Vec<u8>>()
            })
        });
        let mut converter = SampleConverter {
            space,
            plain,
            bits,
            decode,
            table: None,
            channels,
            lab,
            values: vec![0.0; n],
            last: None,
        };
        if n == 1 {
            let table = (0..entries)
                .map(|s| converter.convert_one(&[sample(s) as u16]))
                .collect();
            converter.table = Some(table);
        }
        converter
    }

    /// Converts pixels: `samples` holds a sample per component per pixel;
    /// each pixel's sRGB8 goes to `out`, one every `stride` bytes (`3` for
    /// RGB, `4` to fill RGBA pixels and leave their alpha).
    pub fn convert(&mut self, samples: &[u16], out: &mut [u8], stride: usize) {
        let n = self.decode.len();
        if n == 0 {
            return;
        }
        let stride = stride.max(3);
        let shift = self.bits.saturating_sub(8);
        let pixels = samples
            .chunks_exact(n)
            .zip(out.chunks_mut(stride).filter(|p| p.len() >= 3));
        if let Some(table) = &self.table {
            let last = table.len() - 1;
            for (s, px) in pixels {
                let rgb = table[usize::from(s[0] >> shift).min(last)];
                px[..3].copy_from_slice(&rgb);
            }
        } else if let Some([r, g, b]) = &self.channels {
            let last = r.len() - 1;
            let at = |s: u16| usize::from(s >> shift).min(last);
            if stride == 4 {
                // The common case, written so it compiles to a tight loop.
                for (s, px) in samples.chunks_exact(3).zip(out.chunks_exact_mut(4)) {
                    px[0] = r[at(s[0])];
                    px[1] = g[at(s[1])];
                    px[2] = b[at(s[2])];
                }
                return;
            }
            for (s, px) in pixels {
                px[0] = r[at(s[0])];
                px[1] = g[at(s[1])];
                px[2] = b[at(s[2])];
            }
        } else {
            for (s, px) in pixels {
                let rgb = match &self.last {
                    Some((prev, rgb)) if prev.as_slice() == s => *rgb,
                    _ => {
                        let rgb = self.convert_one(s);
                        match &mut self.last {
                            Some((prev, last)) => {
                                prev.copy_from_slice(s);
                                *last = rgb;
                            }
                            None => self.last = Some((s.to_vec(), rgb)),
                        }
                        rgb
                    }
                };
                px[..3].copy_from_slice(&rgb);
            }
        }
    }

    /// The decoded component values of one pixel's samples.
    pub fn values(&mut self, samples: &[u16]) -> &[f32] {
        for ((v, &(lo, step)), &s) in self.values.iter_mut().zip(&self.decode).zip(samples) {
            *v = lo + f32::from(s) * step;
        }
        &self.values
    }

    fn convert_one(&mut self, samples: &[u16]) -> [u8; 3] {
        let (lab, plain, space) = (self.lab, self.plain, self.space);
        let v = self.values(samples);
        match (plain, lab) {
            (ColorSpace::Cmyk, _) => cmyk_to_rgb(v[0], v[1], v[2], v[3]).map(to_u8),
            (_, Some(lab)) => {
                let l = clamp(v[0], 0.0, 100.0);
                let a = clamp(v[1], lab.range[0], lab.range[1]);
                let b = clamp(v[2], lab.range[2], lab.range[3]);
                xyz_to_srgb_u8(&lab.matrix, lab_to_xyz(l, a, b, lab.white))
            }
            _ => space.to_rgb(v).map(to_u8),
        }
    }
}
