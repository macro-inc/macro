use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A web citation associated with a chat message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ToSchema, Default)]
pub struct WebCitation {
    /// The URL of the citation.
    pub url: String,
    /// The title of the cited page.
    pub title: String,
    /// A description of the cited page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The URL of the page's image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// The URL of the page's favicon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
}
