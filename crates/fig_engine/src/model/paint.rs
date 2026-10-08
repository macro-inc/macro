//! Paints (fills and strokes) and effects.

use super::geom::{Affine, Vec2};
use serde::Serialize;
use std::sync::Arc;

/// Straight (non-premultiplied) RGBA, components in `0..=1`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const BLACK: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };
    pub const WHITE: Color = Color {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    };

    pub fn with_alpha(self, a: f32) -> Color {
        Color { a, ..self }
    }

    pub fn to_skia(self) -> tiny_skia::Color {
        tiny_skia::Color::from_rgba(
            self.r.clamp(0.0, 1.0),
            self.g.clamp(0.0, 1.0),
            self.b.clamp(0.0, 1.0),
            self.a.clamp(0.0, 1.0),
        )
        .unwrap_or(tiny_skia::Color::TRANSPARENT)
    }

    /// `#RRGGBB` (alpha is reported separately in the inspector).
    pub fn hex(self) -> String {
        let c = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("{:02X}{:02X}{:02X}", c(self.r), c(self.g), c(self.b))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BlendMode {
    #[default]
    PassThrough,
    Normal,
    Darken,
    Multiply,
    LinearBurn,
    ColorBurn,
    Lighten,
    Screen,
    LinearDodge,
    ColorDodge,
    Overlay,
    SoftLight,
    HardLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    pub fn parse(s: &str) -> BlendMode {
        use BlendMode::*;
        match s {
            "NORMAL" => Normal,
            "DARKEN" => Darken,
            "MULTIPLY" => Multiply,
            "LINEAR_BURN" => LinearBurn,
            "COLOR_BURN" => ColorBurn,
            "LIGHTEN" => Lighten,
            "SCREEN" => Screen,
            "LINEAR_DODGE" => LinearDodge,
            "COLOR_DODGE" => ColorDodge,
            "OVERLAY" => Overlay,
            "SOFT_LIGHT" => SoftLight,
            "HARD_LIGHT" => HardLight,
            "DIFFERENCE" => Difference,
            "EXCLUSION" => Exclusion,
            "HUE" => Hue,
            "SATURATION" => Saturation,
            "COLOR" => Color,
            "LUMINOSITY" => Luminosity,
            _ => PassThrough,
        }
    }

    /// Whether drawing with this mode is plain source-over.
    pub fn is_normal(self) -> bool {
        matches!(self, BlendMode::Normal | BlendMode::PassThrough)
    }

    pub fn to_skia(self) -> tiny_skia::BlendMode {
        use tiny_skia::BlendMode as B;
        match self {
            BlendMode::PassThrough | BlendMode::Normal => B::SourceOver,
            BlendMode::Darken => B::Darken,
            BlendMode::Multiply => B::Multiply,
            // No linear burn in tiny-skia; multiply is the nearest darkening mode.
            BlendMode::LinearBurn => B::Multiply,
            BlendMode::ColorBurn => B::ColorBurn,
            BlendMode::Lighten => B::Lighten,
            BlendMode::Screen => B::Screen,
            BlendMode::LinearDodge => B::Plus,
            BlendMode::ColorDodge => B::ColorDodge,
            BlendMode::Overlay => B::Overlay,
            BlendMode::SoftLight => B::SoftLight,
            BlendMode::HardLight => B::HardLight,
            BlendMode::Difference => B::Difference,
            BlendMode::Exclusion => B::Exclusion,
            BlendMode::Hue => B::Hue,
            BlendMode::Saturation => B::Saturation,
            BlendMode::Color => B::Color,
            BlendMode::Luminosity => B::Luminosity,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GradientKind {
    Linear,
    Radial,
    Angular,
    Diamond,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct ColorStop {
    pub color: Color,
    pub position: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImageScaleMode {
    /// Figma's "Crop": the paint transform places the image.
    Stretch,
    Fit,
    #[default]
    Fill,
    Tile,
}

/// Image adjustments from the image paint's settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct ImageFilters {
    pub exposure: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub tint: f32,
    pub highlights: f32,
    pub shadows: f32,
}

impl ImageFilters {
    pub fn is_identity(&self) -> bool {
        *self == ImageFilters::default()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ImagePaint {
    /// Lowercase hex SHA-1 of the image file.
    pub hash: Option<Arc<str>>,
    pub scale_mode: ImageScaleMode,
    pub transform: Affine,
    pub scale: f32,
    pub rotation: f32,
    pub filters: ImageFilters,
    pub original_size: Option<Vec2>,
}

/// Alignment of a repeated source tile within its painted layer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PatternAlign {
    #[default]
    Start,
    Center,
    End,
}

impl PatternAlign {
    pub fn parse(value: &str) -> Self {
        match value {
            "CENTER" => Self::Center,
            "END" => Self::End,
            _ => Self::Start,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::Center => "CENTER",
            Self::End => "END",
        }
    }
}

/// Supported layouts for repeating a pattern source.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PatternLayout {
    #[default]
    Rectangular,
    HorizontalHexagonal,
}

impl PatternLayout {
    pub fn name(self) -> &'static str {
        match self {
            Self::Rectangular => "RECTANGULAR",
            Self::HorizontalHexagonal => "HORIZONTAL_HEXAGONAL",
        }
    }
}

/// A rectangular pattern whose tile is another node in the same document.
#[derive(Clone, Debug, PartialEq)]
pub struct PatternPaint {
    pub layout: PatternLayout,
    pub source: super::Guid,
    pub scale: f32,
    /// Gaps as fractions of the source width/height; negative values overlap.
    pub spacing: Vec2,
    pub horizontal: PatternAlign,
    pub vertical: PatternAlign,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PaintKind {
    Solid(Color),
    Gradient {
        kind: GradientKind,
        stops: Arc<[ColorStop]>,
        /// Maps the node's unit square to gradient space.
        transform: Affine,
    },
    Image(ImagePaint),
    Pattern(PatternPaint),
    /// Emoji, video, unsupported pattern layouts, noise: drawn as nothing.
    Unsupported(&'static str),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Paint {
    pub kind: PaintKind,
    pub opacity: f32,
    pub visible: bool,
    pub blend_mode: BlendMode,
    /// The color variable a solid paint's color comes from (the color is
    /// kept, resolved, as Figma stores it).
    pub color_var: Option<super::Guid>,
}

impl Paint {
    pub fn is_visible(&self) -> bool {
        self.visible && self.opacity > 0.0 && !matches!(self.kind, PaintKind::Unsupported(_))
    }

    pub fn solid(color: Color) -> Paint {
        Paint {
            kind: PaintKind::Solid(color),
            opacity: 1.0,
            visible: true,
            blend_mode: BlendMode::Normal,
            color_var: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectKind {
    DropShadow,
    InnerShadow,
    LayerBlur,
    BackgroundBlur,
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Effect {
    pub kind: EffectKind,
    pub visible: bool,
    pub color: Color,
    pub offset: Vec2,
    pub radius: f32,
    pub spread: f32,
    pub blend_mode: BlendMode,
    /// Drop shadows: whether the shadow shows through the node's
    /// transparent areas.
    pub show_behind_node: bool,
}

impl Effect {
    pub fn is_visible(&self) -> bool {
        self.visible && !matches!(self.kind, EffectKind::Other)
    }
}
