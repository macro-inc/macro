//! The option types of the Picture Format and Shape Effects operations
//! (`cropPicture`, `setShapeEffects`, and text effects in `formatText`).

use serde::{Deserialize, Deserializer, Serialize};

/// How `cropPicture` fits a picture's image to its frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum CropMode {
    /// Crop the image to the frame's aspect ratio so it covers the whole
    /// frame (PowerPoint's Crop ▸ Fill).
    Fill,
    /// Pad the image to the frame's aspect ratio so all of it shows inside
    /// the frame (PowerPoint's Crop ▸ Fit).
    Fit,
}

/// One effect of `setShapeEffects` (or a text effect of `formatText`): a
/// preset name (`"none"` removes the effect), or options.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum EffectSpec<T> {
    /// A preset name, or `none` to remove the effect.
    Preset(String),
    /// Options. Omitted ones keep the current effect's values (or the
    /// defaults, for an effect the shape does not have yet).
    Options(T),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for EffectSpec<T> {
    /// A string is a preset and an object holds options; the options are
    /// read with their own type, so a wrong field is reported by name.
    fn deserialize<D: Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        struct Spec<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Spec<T> {
            type Value = EffectSpec<T>;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a preset name or an options object")
            }

            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(EffectSpec::Preset(v.to_owned()))
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                map: A,
            ) -> Result<Self::Value, A::Error> {
                T::deserialize(serde::de::value::MapAccessDeserializer::new(map))
                    .map(EffectSpec::Options)
            }
        }
        de.deserialize_any(Spec(std::marker::PhantomData))
    }
}

/// Shadow options (PowerPoint's Shadow Options pane).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ShadowOptions {
    /// Preset to start from (the names `shadow` takes); omitted: the
    /// current shadow, or `outerBottomRight` when there is none.
    pub preset: Option<String>,
    /// Color: `RRGGBB` or a theme color name (presets use black).
    pub color: Option<String>,
    /// Transparency 0-1 (0 = opaque).
    pub transparency: Option<f32>,
    /// Size in percent of the shape (outer shadows only; 100 = same size).
    pub size_pct: Option<f32>,
    /// Blur radius in points.
    pub blur_pt: Option<f32>,
    /// Distance from the shape in points.
    pub distance_pt: Option<f32>,
    /// Direction the shadow falls, in degrees clockwise from the right
    /// (45 = toward the bottom right, 90 = straight down).
    pub angle_deg: Option<f32>,
}

/// Glow options (PowerPoint's Glow Options).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct GlowOptions {
    /// Color: `RRGGBB` or a theme color name (`accent1`...; theme colors
    /// get PowerPoint's 175% saturation). A new glow defaults to `accent1`.
    pub color: Option<String>,
    /// Glow size in points (a new glow defaults to 10; 0 removes the glow).
    pub size_pt: Option<f32>,
    /// Transparency 0-1 (a new glow defaults to 0.6).
    pub transparency: Option<f32>,
}

/// Soft edge options.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SoftEdgeOptions {
    /// Width of the feathered edge in points (a new soft edge defaults to
    /// 5; 0 removes it).
    pub size_pt: Option<f32>,
}

/// Reflection options (PowerPoint's Reflection Options).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReflectionOptions {
    /// Preset to start from (the names `reflection` takes); omitted: the
    /// current reflection, or `tightTouching` when there is none.
    pub preset: Option<String>,
    /// Transparency 0-1 where the reflection starts (it fades out from there).
    pub transparency: Option<f32>,
    /// How much of the shape is reflected, in percent of its height (1-100).
    pub size_pct: Option<f32>,
    /// Gap between the shape and its reflection in points.
    pub distance_pt: Option<f32>,
    /// Blur radius in points.
    pub blur_pt: Option<f32>,
}
