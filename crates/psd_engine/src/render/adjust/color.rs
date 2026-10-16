//! Adjustments that work on whole colors rather than channel by channel:
//! Hue/Saturation, Vibrance, Color Balance, Black & White, Photo Filter,
//! Channel Mixer, and Selective Color.

use crate::model::{Adjustment, HueRange};
use crate::render::blend::{lum, set_lum};

/// A prepared per-pixel color adjustment.
pub(crate) enum ColorAdjustment {
    /// Colorize: every pixel takes one hue and saturation.
    Colorize {
        /// Hue in turns.
        hue: f32,
        /// Saturation, `0..=1`.
        saturation: f32,
        /// Lightness, `-1..=1`.
        lightness: f32,
    },
    /// Hue/Saturation with the master and per-range settings.
    HueSaturation {
        /// Master hue in turns, saturation and lightness in `-1..=1`.
        master: [f32; 3],
        /// Ranges in turns `[begin falloff, begin, end, end falloff]`,
        /// with their hue (turns), saturation, and lightness.
        ranges: Vec<([f32; 4], [f32; 3])>,
    },
    /// Vibrance and saturation, `-1..=1`.
    Vibrance {
        /// Vibrance.
        vibrance: f32,
        /// Saturation.
        saturation: f32,
    },
    /// Color Balance shifts per tone range (`-1..=1`).
    ColorBalance {
        /// Shadows, midtones, highlights; each cyan–red, magenta–green,
        /// yellow–blue.
        ranges: [[f32; 3]; 3],
        /// Keeps each pixel's lightness.
        preserve: bool,
    },
    /// Black & White.
    BlackWhite {
        /// Reds, yellows, greens, cyans, blues, magentas weights.
        weights: [f32; 6],
        /// Tint color.
        tint: Option<[f32; 3]>,
    },
    /// Photo Filter.
    PhotoFilter {
        /// Filter color.
        color: [f32; 3],
        /// Density.
        density: f32,
        /// Keeps luminosity.
        preserve: bool,
    },
    /// Channel Mixer rows (fractions; the constant as an offset).
    ChannelMixer {
        /// Output rows.
        rows: [[f32; 4]; 3],
    },
    /// Selective Color.
    SelectiveColor {
        /// Absolute rather than relative.
        absolute: bool,
        /// Cyan, magenta, yellow, black per range (fractions).
        colors: [[f32; 4]; 9],
    },
}

impl ColorAdjustment {
    /// Prepares one of the per-pixel adjustments (`None` when it changes
    /// nothing or is not one of them).
    pub(crate) fn new(adjustment: &Adjustment) -> Option<ColorAdjustment> {
        let pct = |v: i16| v as f32 / 100.0;
        Some(match adjustment {
            Adjustment::HueSaturation {
                colorize,
                colorization,
                master,
                ranges,
            } => {
                if *colorize {
                    let (h, s, l) = *colorization;
                    ColorAdjustment::Colorize {
                        hue: (h as f32 / 360.0).rem_euclid(1.0),
                        saturation: pct(s).clamp(0.0, 1.0),
                        lightness: pct(l).clamp(-1.0, 1.0),
                    }
                } else {
                    let master = [
                        master.0 as f32 / 360.0,
                        pct(master.1).clamp(-1.0, 1.0),
                        pct(master.2).clamp(-1.0, 1.0),
                    ];
                    let ranges: Vec<_> = ranges
                        .iter()
                        .filter(|r| r.hue != 0 || r.saturation != 0 || r.lightness != 0)
                        .map(|r: &HueRange| {
                            (
                                r.range.map(|v| v as f32 / 360.0),
                                [
                                    r.hue as f32 / 360.0,
                                    pct(r.saturation).clamp(-1.0, 1.0),
                                    pct(r.lightness).clamp(-1.0, 1.0),
                                ],
                            )
                        })
                        .collect();
                    if master == [0.0; 3] && ranges.is_empty() {
                        return None;
                    }
                    ColorAdjustment::HueSaturation { master, ranges }
                }
            }
            Adjustment::Vibrance {
                vibrance,
                saturation,
            } => {
                if *vibrance == 0 && *saturation == 0 {
                    return None;
                }
                ColorAdjustment::Vibrance {
                    vibrance: pct(*vibrance).clamp(-1.0, 1.0),
                    saturation: pct(*saturation).clamp(-1.0, 1.0),
                }
            }
            Adjustment::ColorBalance {
                shadows,
                midtones,
                highlights,
                preserve_luminosity,
            } => {
                let ranges = [*shadows, *midtones, *highlights].map(|r| r.map(pct));
                if ranges == [[0.0; 3]; 3] {
                    return None;
                }
                ColorAdjustment::ColorBalance {
                    ranges,
                    preserve: *preserve_luminosity,
                }
            }
            Adjustment::BlackWhite { weights, tint } => ColorAdjustment::BlackWhite {
                weights: weights.map(pct),
                tint: tint.map(|t| [t.r, t.g, t.b]),
            },
            Adjustment::PhotoFilter {
                color,
                density,
                preserve_luminosity,
            } => {
                if *density <= 0.0 {
                    return None;
                }
                ColorAdjustment::PhotoFilter {
                    color: [color.r, color.g, color.b],
                    density: density.clamp(0.0, 1.0),
                    preserve: *preserve_luminosity,
                }
            }
            Adjustment::ChannelMixer { monochrome, rows } => {
                let row = |r: [i16; 4]| [pct(r[0]), pct(r[1]), pct(r[2]), r[3] as f32 / 200.0];
                let rows = if *monochrome {
                    [row(rows[0]); 3]
                } else {
                    rows.map(row)
                };
                ColorAdjustment::ChannelMixer { rows }
            }
            Adjustment::SelectiveColor { absolute, colors } => {
                if colors.iter().all(|c| *c == [0; 4]) {
                    return None;
                }
                ColorAdjustment::SelectiveColor {
                    absolute: *absolute,
                    colors: colors.map(|c| c.map(|v| pct(v).clamp(-1.0, 1.0))),
                }
            }
            _ => return None,
        })
    }

    /// The adjusted straight color.
    pub(crate) fn apply(&self, c: [f32; 3]) -> [f32; 3] {
        match self {
            ColorAdjustment::Colorize {
                hue,
                saturation,
                lightness,
            } => {
                let [_, _, l] = rgb_to_hsl(c);
                hsl_to_rgb([*hue, *saturation, apply_lightness(l, *lightness)])
            }
            ColorAdjustment::HueSaturation { master, ranges } => hue_saturation(c, *master, ranges),
            ColorAdjustment::Vibrance {
                vibrance,
                saturation,
            } => {
                let max = c[0].max(c[1]).max(c[2]);
                let min = c[0].min(c[1]).min(c[2]);
                // Vibrance boosts dull colors most; saturation all alike.
                let k = (1.0 + vibrance * (1.0 - (max - min))) * (1.0 + saturation);
                let l = lum(c);
                set_lum(c.map(|v| l + (v - l) * k.max(0.0)), l)
            }
            ColorAdjustment::ColorBalance { ranges, preserve } => {
                color_balance(c, ranges, *preserve)
            }
            ColorAdjustment::BlackWhite { weights, tint } => {
                let g = black_white(c, weights).clamp(0.0, 1.0);
                match tint {
                    Some(t) => set_lum(*t, g),
                    None => [g; 3],
                }
            }
            ColorAdjustment::PhotoFilter {
                color,
                density,
                preserve,
            } => {
                let out: [f32; 3] =
                    std::array::from_fn(|i| c[i] + (c[i] * color[i] - c[i]) * density);
                if *preserve { set_lum(out, lum(c)) } else { out }
            }
            ColorAdjustment::ChannelMixer { rows } => {
                rows.map(|r| (c[0] * r[0] + c[1] * r[1] + c[2] * r[2] + r[3]).clamp(0.0, 1.0))
            }
            ColorAdjustment::SelectiveColor { absolute, colors } => {
                selective_color(c, colors, *absolute)
            }
        }
    }
}

/// Straight RGB to hue (turns), saturation, lightness.
pub(crate) fn rgb_to_hsl(c: [f32; 3]) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let l = (max + min) * 0.5;
    let d = max - min;
    if d <= 1e-6 {
        return [0.0, 0.0, l];
    }
    let s = d / (1.0 - (2.0 * l - 1.0).abs()).max(1e-6);
    let h = if max == c[0] {
        ((c[1] - c[2]) / d).rem_euclid(6.0)
    } else if max == c[1] {
        (c[2] - c[0]) / d + 2.0
    } else {
        (c[0] - c[1]) / d + 4.0
    };
    [h / 6.0, s.min(1.0), l]
}

/// Hue (turns), saturation, lightness to straight RGB.
pub(crate) fn hsl_to_rgb(hsl: [f32; 3]) -> [f32; 3] {
    let [h, s, l] = hsl;
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h6 = h.rem_euclid(1.0) * 6.0;
    let x = c * (1.0 - (h6 % 2.0 - 1.0).abs());
    let (r, g, b) = match h6 as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c * 0.5;
    [r + m, g + m, b + m].map(|v| v.clamp(0.0, 1.0))
}

/// Lightness toward white (positive) or black (negative).
fn apply_lightness(v: f32, lightness: f32) -> f32 {
    if lightness > 0.0 {
        v * (1.0 - lightness) + lightness
    } else {
        v * (1.0 + lightness)
    }
}

/// Saturation scaled up (dividing) or down (multiplying).
fn apply_saturation(s: f32, saturation: f32) -> f32 {
    if saturation > 0.0 {
        (s / (1.0 - saturation + 0.01)).clamp(0.0, 1.0)
    } else {
        (s * (1.0 + saturation)).clamp(0.0, 1.0)
    }
}

/// How much a hue (turns) is in a range `[begin falloff, begin, end, end
/// falloff]`: 1 inside, ramping to 0 across the falloffs.
fn range_weight(hue: f32, r: &[f32; 4]) -> f32 {
    let centered = (hue - r[0]).rem_euclid(1.0);
    let left = (r[1] - r[0]).rem_euclid(1.0);
    let center = (r[2] - r[0]).rem_euclid(1.0);
    let right = (r[3] - r[0]).rem_euclid(1.0);
    if centered >= left && centered <= center {
        1.0
    } else if centered < left {
        if left > 1e-6 { centered / left } else { 0.0 }
    } else if centered <= right && right - center > 1e-6 {
        (right - centered) / (right - center)
    } else {
        0.0
    }
}

/// Hue/Saturation after psd-tools' model of Photoshop's: master lightness
/// first, range lightness in HSV, then hue shifts and saturation in HSL.
fn hue_saturation(c: [f32; 3], master: [f32; 3], ranges: &[([f32; 4], [f32; 3])]) -> [f32; 3] {
    let c = c.map(|v| apply_lightness(v, master[2]).clamp(0.0, 1.0));
    let [h, s, l] = rgb_to_hsl(c);
    let (mut rh, mut rs, mut rl) = (0.0f32, 0.0f32, 0.0f32);
    for (range, [dh, ds, dl]) in ranges {
        let w = range_weight(h, range);
        if w <= 0.0 {
            continue;
        }
        rh += dh * w;
        rl = (rl + dl * w).clamp(-1.0, 1.0);
        let contribution = if *ds > 0.0 {
            ds * (1.0 - (1.0 - w).powf(1.5 / (1.0 - ds.powi(4) + 0.05)))
        } else {
            ds * w
        };
        rs = (rs + contribution).clamp(-1.0, 1.0);
    }
    // Range lightness, in HSV.
    let v = l + s * l.min(1.0 - l);
    let mut sv = if v > 1e-6 { 2.0 * (1.0 - l / v) } else { 0.0 };
    let mut v2 = v;
    if rl < 0.0 {
        v2 = (v * (1.0 + rl * sv)).clamp(0.0, 1.0);
        let div = 1.0 / (sv + 1e-3);
        sv = (1.0 + (div - 1.0) / (rl.abs() - div + 1e-3)).clamp(0.0, 1.0);
    } else if rl > 0.0 {
        sv = (sv * (1.0 - rl)).clamp(0.0, 1.0);
    }
    let l2 = v2 * (1.0 - sv * 0.5);
    let denom = l2.min(1.0 - l2);
    let s2 = if denom > 1e-6 { (v2 - l2) / denom } else { 0.0 };
    let h2 = (h + rh + master[0]).rem_euclid(1.0);
    let s3 = apply_saturation(apply_saturation(s2, master[1]), rs);
    hsl_to_rgb([h2, s3, l2])
}

/// Color Balance as GIMP models Photoshop's: each shift weighted by how
/// much the pixel's lightness is in shadows, midtones, or highlights.
fn color_balance(c: [f32; 3], ranges: &[[f32; 3]; 3], preserve: bool) -> [f32; 3] {
    const A: f32 = 0.25;
    const B: f32 = 0.333;
    const SCALE: f32 = 0.7;
    let [_, _, l] = rgb_to_hsl(c);
    let shadows = ((l - B) / -A + 0.5).clamp(0.0, 1.0) * SCALE;
    let midtones =
        ((l - B) / A + 0.5).clamp(0.0, 1.0) * ((l + B - 1.0) / -A + 0.5).clamp(0.0, 1.0) * SCALE;
    let highlights = ((l + B - 1.0) / A + 0.5).clamp(0.0, 1.0) * SCALE;
    let out: [f32; 3] = std::array::from_fn(|i| {
        (c[i] + ranges[0][i] * shadows + ranges[1][i] * midtones + ranges[2][i] * highlights)
            .clamp(0.0, 1.0)
    });
    if preserve {
        let [h, s, _] = rgb_to_hsl(out);
        hsl_to_rgb([h, s, l])
    } else {
        out
    }
}

/// Black & White: the gray part counts fully, the secondary color part
/// (the two largest channels above the smallest) and the primary part (the
/// largest above the middle) by their colors' weights.
fn black_white(c: [f32; 3], w: &[f32; 6]) -> f32 {
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].total_cmp(&c[b]));
    let [lo, mid, hi] = idx;
    // Weights: 0 reds, 1 yellows, 2 greens, 3 cyans, 4 blues, 5 magentas.
    let primary = [0, 2, 4][hi];
    let secondary = match lo {
        0 => 3, // green and blue: cyan
        1 => 5, // red and blue: magenta
        _ => 1, // red and green: yellow
    };
    c[lo] + (c[mid] - c[lo]) * w[secondary] + (c[hi] - c[mid]) * w[primary]
}

/// Selective Color: each range's share of the pixel (its primary or
/// secondary color part, or its whites, neutrals, or blacks) scales that
/// range's ink changes.
fn selective_color(c: [f32; 3], colors: &[[f32; 4]; 9], absolute: bool) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].total_cmp(&c[b]));
    let mid = c[idx[1]];
    let mut amounts = [0.0f32; 9];
    // Reds, greens, blues: the largest channel above the middle one.
    amounts[[0, 2, 4][idx[2]]] = max - mid;
    // Cyans, magentas, yellows: the two largest above the smallest.
    amounts[[3, 5, 1][idx[0]]] = mid - min;
    amounts[6] = ((min - 0.5) * 2.0).max(0.0);
    amounts[8] = ((0.5 - max) * 2.0).max(0.0);
    amounts[7] = (1.0 - ((max - 0.5).abs() + (min - 0.5).abs())).max(0.0);
    let mut out = c;
    for (range, adj) in colors.iter().enumerate() {
        let amount = amounts[range];
        if amount <= 0.0 {
            continue;
        }
        let k = adj[3];
        for ch in 0..3 {
            let v = c[ch];
            // Inks are the channels' complements; black adds to all three.
            let ink = (-1.0 - adj[ch]) * k - adj[ch];
            let delta = if absolute { ink } else { ink * (1.0 - v) };
            out[ch] += delta.max(-v).min(1.0 - v) * amount;
        }
    }
    out.map(|v| v.clamp(0.0, 1.0))
}
