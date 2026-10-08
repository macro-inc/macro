//! The option types of the Slide Master operations (`insertPlaceholder`).

use serde::{Deserialize, Serialize};

/// What a placeholder inserted on a slide layout holds (PowerPoint's Slide
/// Master ▸ Insert Placeholder menu).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum PlaceholderKind {
    /// Any content: text with bullets, or a picture, chart, table, SmartArt,
    /// or media (an untyped `obj` placeholder).
    Content,
    /// Text only (`body`).
    Text,
    /// A picture (`pic`).
    Picture,
    /// A chart (`chart`).
    Chart,
    /// A table (`tbl`).
    Table,
    /// SmartArt (`dgm`).
    SmartArt,
    /// Video or audio (`media`).
    Media,
}

impl PlaceholderKind {
    /// The `p:ph/@type` it is written with (`None` for content: `obj`, the default).
    pub fn ph_type(self) -> Option<&'static str> {
        match self {
            Self::Content => None,
            Self::Text => Some("body"),
            Self::Picture => Some("pic"),
            Self::Chart => Some("chart"),
            Self::Table => Some("tbl"),
            Self::SmartArt => Some("dgm"),
            Self::Media => Some("media"),
        }
    }

    /// The name PowerPoint gives the shape (before its number).
    pub fn shape_name(self) -> &'static str {
        match self {
            Self::Content => "Content Placeholder",
            Self::Text => "Text Placeholder",
            Self::Picture => "Picture Placeholder",
            Self::Chart => "Chart Placeholder",
            Self::Table => "Table Placeholder",
            Self::SmartArt => "SmartArt Placeholder",
            Self::Media => "Media Placeholder",
        }
    }

    /// The label a placeholder that holds no text shows in Slide Master view.
    pub fn label(self) -> Option<&'static str> {
        match self {
            Self::Content | Self::Text => None,
            Self::Picture => Some("Picture"),
            Self::Chart => Some("Chart"),
            Self::Table => Some("Table"),
            Self::SmartArt => Some("SmartArt"),
            Self::Media => Some("Media"),
        }
    }
}
