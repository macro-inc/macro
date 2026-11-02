//! Shared entity presentation values. Owning domains persist and authorize changes.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

mod icons {
    include!("appearance_icons.generated.rs");
}

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
                if icons::ICON_NAMES.contains(&name.as_str()) {
                    Ok(())
                } else {
                    Err("Unknown Macro icon".into())
                }
            }
            Some(AppearanceIcon::Emoji { value }) => {
                // Accept qualified and unqualified forms, but reject lookup aliases
                // that omit a sequence component such as the combining keycap.
                let is_emoji = value.len() <= 64
                    && emojis::get(value).is_some_and(|emoji| {
                        emoji
                            .as_str()
                            .chars()
                            .filter(|&c| c != '\u{fe0f}')
                            .eq(value.chars().filter(|&c| c != '\u{fe0f}'))
                    });
                if is_emoji {
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
