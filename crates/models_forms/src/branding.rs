//! How a form looks to respondents beyond its words: a logo, a cover image
//! and an accent color. Every part is optional; a form with none looks like
//! any other Macro page.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A form's logo, cover image and accent color, each unset by default.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct FormBranding {
    /// The static file shown as the logo above the title.
    #[schema(required = true)]
    pub logo_file_id: Option<Uuid>,
    /// The static file shown as a banner across the top of the page.
    #[schema(required = true)]
    pub cover_file_id: Option<Uuid>,
    /// The color of the page's buttons, selections and focus rings.
    #[schema(required = true)]
    pub accent_color: Option<AccentColor>,
}

/// A color as `#rrggbb`, kept in lowercase.
#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(try_from = "String", into = "String")]
#[schema(value_type = String, pattern = "^#[0-9a-fA-F]{6}$")]
#[specta(transparent)]
pub struct AccentColor(String);

/// A color that is not `#` and six hex digits.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("an accent color is # and six hex digits, like #1f6feb")]
pub struct InvalidAccentColor;

// The string's own schema, inlined, as a color is a string to its readers.
#[cfg(feature = "schema")]
impl schemars::JsonSchema for AccentColor {
    fn inline_schema() -> bool {
        <String as schemars::JsonSchema>::inline_schema()
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        <String as schemars::JsonSchema>::schema_name()
    }

    fn schema_id() -> std::borrow::Cow<'static, str> {
        <String as schemars::JsonSchema>::schema_id()
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        <String as schemars::JsonSchema>::json_schema(generator)
    }
}

impl AccentColor {
    /// The color as `#rrggbb`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AccentColor {
    type Error = InvalidAccentColor;

    fn try_from(color: String) -> Result<Self, Self::Error> {
        if lazy_regex::regex_is_match!("^#[0-9a-fA-F]{6}$", &color) {
            Ok(Self(color.to_ascii_lowercase()))
        } else {
            Err(InvalidAccentColor)
        }
    }
}

impl From<AccentColor> for String {
    fn from(color: AccentColor) -> Self {
        color.0
    }
}
