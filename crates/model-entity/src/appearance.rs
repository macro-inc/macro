//! Shared entity presentation values. Owning domains persist and authorize changes.

use serde::{Deserialize, Serialize};
use unicode_segmentation::UnicodeSegmentation;
use utoipa::ToSchema;

/// An entity's optional icon and tint overrides; absent values retain type defaults.
#[derive(
    Debug,
    Clone,
    Default,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    specta::Type,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityAppearance {
    /// A custom Macro glyph or a native emoji.
    #[serde(default)]
    pub icon: Option<AppearanceIcon>,
    /// A theme-aware palette key. Native emoji retain their own colors.
    #[serde(default)]
    pub color: Option<AppearanceColor>,
}

/// The source of an entity's custom icon.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    specta::Type,
)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AppearanceIcon {
    /// A stable name from Macro's original, distinct icon catalog.
    Macro {
        /// Catalog name without the SVG extension.
        name: String,
    },
    /// A single native emoji, including skin-tone and joined sequences.
    Emoji {
        /// Unicode emoji text, not markup or a URL.
        value: String,
    },
}

/// Semantic tint keys; themes own the rendered colors.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    ToSchema,
    schemars::JsonSchema,
    specta::Type,
)]
#[serde(rename_all = "snake_case")]
pub enum AppearanceColor {
    /// Neutral.
    Gray,
    /// Red.
    Red,
    /// Orange.
    Orange,
    /// Yellow.
    Yellow,
    /// Green.
    Green,
    /// Teal.
    Teal,
    /// Blue.
    Blue,
    /// Purple.
    Purple,
    /// Pink.
    Pink,
}

impl EntityAppearance {
    /// Reject unsupported glyphs and anything other than a single emoji sequence.
    pub fn validate(&self) -> Result<(), String> {
        match &self.icon {
            None => Ok(()),
            Some(AppearanceIcon::Macro { name }) => {
                if include_str!("appearance-icons.txt")
                    .lines()
                    .any(|allowed| allowed == name)
                {
                    Ok(())
                } else {
                    Err("Unknown Macro icon".into())
                }
            }
            Some(AppearanceIcon::Emoji { value }) => {
                let has_emoji_base = value.chars().any(|c| {
                    matches!(c as u32,
                        0x1f000..=0x1faff | 0x2300..=0x23ff | 0x2600..=0x27bf |
                        0x2b00..=0x2bff | 0x00a9 | 0x00ae | 0x203c | 0x2049 |
                        0x2122 | 0x2139 | 0x3030 | 0x303d | 0x3297 | 0x3299 | 0x20e3)
                });
                if value.len() <= 64
                    && value.graphemes(true).count() == 1
                    && !value.chars().any(char::is_control)
                    && has_emoji_base
                {
                    Ok(())
                } else {
                    Err("Choose a single emoji".into())
                }
            }
        }
    }

    /// Whether both overrides use their entity type's defaults.
    pub fn is_default(&self) -> bool {
        self.icon.is_none() && self.color.is_none()
    }
}

#[cfg(test)]
mod test;
