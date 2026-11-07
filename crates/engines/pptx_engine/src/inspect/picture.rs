//! Outlines of pictures (crop and adjustments) and of shape and text
//! effects, in the terms `cropPicture`, `formatPicture`, and
//! `setShapeEffects` take.

use serde::Serialize;

/// A picture's crop and adjustments.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureOutline {
    /// How much of the original image is cropped off each edge. The whole
    /// image spans the picture's box grown by these fractions of the image:
    /// in the box's own (unrotated) coordinates its width is
    /// `w / (1 - left - right)`, its left edge `x - left × that width`, and
    /// likewise vertically.
    pub crop: CropOutline,
    /// Brightness from -1 to 1 (0 = unchanged).
    pub brightness: f32,
    /// Contrast from -1 to 1 (0 = unchanged).
    pub contrast: f32,
    /// Recolor, as `formatPicture` takes it (`none`, `grayscale`, `sepia`,
    /// `washout`, `blackWhite`, `blackWhite25`, `blackWhite75`,
    /// `duotone:<color>`, `duotoneLight:<color>`, `duotone:<dark>,<light>`).
    pub recolor: String,
    /// Transparency from 0 (opaque) to 1.
    pub transparency: f32,
    /// Pixel width of the image, when its header gives it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natural_width: Option<u32>,
    /// Pixel height of the image, when its header gives it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub natural_height: Option<u32>,
}

/// Fractions of the original image cropped off each edge (negative = padding).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropOutline {
    /// Left, as a fraction of the image width.
    pub left: f32,
    /// Top, as a fraction of the image height.
    pub top: f32,
    /// Right, as a fraction of the image width.
    pub right: f32,
    /// Bottom, as a fraction of the image height.
    pub bottom: f32,
}

/// A shape's effects, in the terms `setShapeEffects` takes.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectsOutline {
    /// Shadow (an outer one when the shape has both kinds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<ShadowOutline>,
    /// Glow.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glow: Option<GlowOutline>,
    /// Soft edges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soft_edge: Option<SoftEdgeOutline>,
    /// Reflection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection: Option<ReflectionOutline>,
    /// The effects come from the theme's effect style (or a layout
    /// placeholder), not from the shape itself.
    pub inherited: bool,
}

/// A shadow.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowOutline {
    /// `outer` or `inner`.
    pub kind: &'static str,
    /// The gallery preset these values match, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<&'static str>,
    /// Color as `#RRGGBB`.
    pub color: String,
    /// Transparency from 0 (opaque) to 1.
    pub transparency: f32,
    /// Size in percent of the shape (100 for inner shadows).
    pub size_pct: f32,
    /// Blur radius in points.
    pub blur_pt: f32,
    /// Distance in points.
    pub distance_pt: f32,
    /// Direction in degrees clockwise from the right.
    pub angle_deg: f32,
}

/// A glow.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlowOutline {
    /// Color as `#RRGGBB`.
    pub color: String,
    /// Transparency from 0 (opaque) to 1.
    pub transparency: f32,
    /// Size in points.
    pub size_pt: f32,
}

/// Soft edges.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftEdgeOutline {
    /// Width of the feathered edge in points.
    pub size_pt: f32,
}

/// A reflection.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionOutline {
    /// The gallery preset these values match, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<&'static str>,
    /// Transparency where the reflection starts, from 0 (opaque) to 1.
    pub transparency: f32,
    /// How much of the shape is reflected, in percent of its height.
    pub size_pct: f32,
    /// Gap between the shape and the reflection in points.
    pub distance_pt: f32,
    /// Blur radius in points.
    pub blur_pt: f32,
}
