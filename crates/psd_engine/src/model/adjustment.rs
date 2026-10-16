//! Adjustment layers' settings.

use super::*;
use serde::{Deserialize, Serialize};

/// One channel's Levels: input black and white points, gamma, and output
/// black and white points (8-bit values).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelsChannel {
    /// Input black point.
    pub in_black: u8,
    /// Input white point.
    pub in_white: u8,
    /// Output black point.
    pub out_black: u8,
    /// Output white point.
    pub out_white: u8,
    /// Gamma (midtones), `0.1..=9.99`.
    pub gamma: f32,
}

impl Default for LevelsChannel {
    fn default() -> Self {
        LevelsChannel {
            in_black: 0,
            in_white: 255,
            out_black: 0,
            out_white: 255,
            gamma: 1.0,
        }
    }
}

/// One color range of Hue/Saturation: its hue range and adjustments.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HueRange {
    /// Hue range `[begin falloff, begin, end, end falloff]`, in degrees.
    pub range: [i16; 4],
    /// Hue shift, `-180..=180`.
    pub hue: i16,
    /// Saturation, `-100..=100`.
    pub saturation: i16,
    /// Lightness, `-100..=100`.
    pub lightness: i16,
}

/// Adjustment layers' settings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Adjustment {
    /// Brightness/Contrast.
    BrightnessContrast {
        /// `-150..=150`.
        brightness: i16,
        /// `-50..=100`.
        contrast: i16,
        /// Legacy (pre-CS3) behavior.
        legacy: bool,
    },
    /// Levels: the composite channel first, then each color channel.
    Levels {
        /// Composite, red, green, blue (missing channels are unchanged).
        channels: Vec<LevelsChannel>,
    },
    /// Curves: points per channel (composite first).
    Curves {
        /// `(channel, points)`: channel 0 is the composite, 1–3 red,
        /// green, blue; points are `(input, output)` 8-bit values.
        channels: Vec<(u8, Vec<(u8, u8)>)>,
    },
    /// Exposure.
    Exposure {
        /// Stops, `-20..=20`.
        exposure: f32,
        /// Offset, `-0.5..=0.5`.
        offset: f32,
        /// Gamma correction, `0.01..=9.99`.
        gamma: f32,
    },
    /// Vibrance.
    Vibrance {
        /// `-100..=100`.
        vibrance: i16,
        /// `-100..=100`.
        saturation: i16,
    },
    /// Hue/Saturation.
    HueSaturation {
        /// Colorize instead of shifting.
        colorize: bool,
        /// Colorize hue, saturation, lightness.
        colorization: (i16, i16, i16),
        /// Master hue, saturation, lightness.
        master: (i16, i16, i16),
        /// Reds, yellows, greens, cyans, blues, magentas.
        ranges: Vec<HueRange>,
    },
    /// Color Balance: cyan–red, magenta–green, yellow–blue per tone range.
    ColorBalance {
        /// Shadows, `-100..=100` each.
        shadows: [i16; 3],
        /// Midtones.
        midtones: [i16; 3],
        /// Highlights.
        highlights: [i16; 3],
        /// Keeps luminosity.
        preserve_luminosity: bool,
    },
    /// Black & White.
    BlackWhite {
        /// Reds, yellows, greens, cyans, blues, magentas, in percent.
        weights: [i16; 6],
        /// A tint, when enabled.
        tint: Option<Rgb>,
    },
    /// Photo Filter.
    PhotoFilter {
        /// The filter color.
        color: Rgb,
        /// Density, `0..=1`.
        density: f32,
        /// Keeps luminosity.
        preserve_luminosity: bool,
    },
    /// Channel Mixer: output red, green, blue rows of red, green, blue,
    /// constant (percent).
    ChannelMixer {
        /// Monochrome output (the red row only).
        monochrome: bool,
        /// Rows.
        rows: [[i16; 4]; 3],
    },
    /// Invert.
    Invert,
    /// Posterize.
    Posterize {
        /// Levels, `2..=255`.
        levels: u8,
    },
    /// Threshold.
    Threshold {
        /// Level, `1..=255`.
        level: u8,
    },
    /// Gradient Map.
    GradientMap {
        /// The gradient luminosity is mapped through.
        gradient: Gradient,
        /// Dithered.
        dither: bool,
        /// Reversed.
        reverse: bool,
    },
    /// Selective Color: cyan, magenta, yellow, black adjustments (percent)
    /// for reds, yellows, greens, cyans, blues, magentas, whites, neutrals,
    /// blacks.
    SelectiveColor {
        /// Absolute rather than relative.
        absolute: bool,
        /// One row per color range.
        colors: [[i16; 4]; 9],
    },
    /// An adjustment the engine keeps but does not draw (Color Lookup,
    /// HDR Toning, and the rest).
    Other {
        /// Its tagged block key.
        key: String,
    },
}

impl Adjustment {
    /// The name Photoshop gives new layers of this kind.
    pub fn label(&self) -> &'static str {
        match self {
            Adjustment::BrightnessContrast { .. } => "Brightness/Contrast",
            Adjustment::Levels { .. } => "Levels",
            Adjustment::Curves { .. } => "Curves",
            Adjustment::Exposure { .. } => "Exposure",
            Adjustment::Vibrance { .. } => "Vibrance",
            Adjustment::HueSaturation { .. } => "Hue/Saturation",
            Adjustment::ColorBalance { .. } => "Color Balance",
            Adjustment::BlackWhite { .. } => "Black & White",
            Adjustment::PhotoFilter { .. } => "Photo Filter",
            Adjustment::ChannelMixer { .. } => "Channel Mixer",
            Adjustment::Invert => "Invert",
            Adjustment::Posterize { .. } => "Posterize",
            Adjustment::Threshold { .. } => "Threshold",
            Adjustment::GradientMap { .. } => "Gradient Map",
            Adjustment::SelectiveColor { .. } => "Selective Color",
            Adjustment::Other { .. } => "Adjustment",
        }
    }
}
