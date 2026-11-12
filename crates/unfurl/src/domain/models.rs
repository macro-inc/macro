//! Domain models for the unfurl crate.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

use super::url_parsers::{EmbedInfo, EmbedType, parse_custom_title, parse_embed_info};

#[cfg(test)]
mod test;

/// Key of the page's first paragraph of body text among the fetched tags.
pub const FIRST_PARAGRAPH_KEY: &str = "paragraph";

/// Where a page says what it is about, most specific first. A page that says
/// so nowhere in its head, as encyclopedia articles do, is described by its
/// first paragraph.
const DESCRIPTION_KEYS: [&str; 5] = [
    "property:og:description",
    "name:twitter:description",
    "property:twitter:description",
    "name:description",
    FIRST_PARAGRAPH_KEY,
];

/// Longest description kept, in characters: more than a preview shows.
const MAX_DESCRIPTION_CHARS: usize = 500;

/// The type of embeddable content for services that support iframe embedding.
#[derive(Debug, Serialize, Deserialize, Default, Clone, Eq, PartialEq)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum UnfurlEmbedType {
    /// No embeddable content.
    #[default]
    None,
    /// Video content (Loom, Supercut, etc.).
    Video,
}

impl From<EmbedType> for UnfurlEmbedType {
    fn from(embed_type: EmbedType) -> Self {
        match embed_type {
            EmbedType::Video => UnfurlEmbedType::Video,
        }
    }
}

/// Unfurl response for a single URL: the URL itself plus any metadata that
/// was extracted from the page's `<head>` (title, description, image,
/// favicon).
#[derive(Debug, Serialize, Deserialize, Default, Clone, Eq, PartialEq)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct GetUnfurlResponse {
    /// The URL that was unfurled.
    pub url: String,
    /// The page title (from custom URL parser, Open Graph, or `<title>`).
    pub title: String,
    /// What the page says it is about: its Open Graph, Twitter card, or
    /// `<meta>` description, else its first paragraph. On one line, cut to a
    /// length a preview can show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The page's preview image URL (from `og:image`), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// The page's favicon URL, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
    /// The type of embeddable content, if the URL supports iframe embedding.
    #[serde(default, skip_serializing_if = "is_embed_type_none")]
    pub embed_type: UnfurlEmbedType,
    /// The iframe-embeddable URL for services like Loom or Supercut.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embed_url: Option<String>,
}

fn is_embed_type_none(embed_type: &UnfurlEmbedType) -> bool {
    matches!(embed_type, UnfurlEmbedType::None)
}

impl GetUnfurlResponse {
    /// Resolve the title for `url`, given previously-extracted `metatags`.
    ///
    /// Custom URL parsers (Notion, Figma, Linear) win over meta tags so that
    /// services which embed their titles in URLs but render generic HTML
    /// titles still produce useful previews. Falls back to `og:title`,
    /// `og:site_name`, `<title>`, and finally the URL string itself.
    pub fn get_title(url: &str, metatags: &HashMap<String, String>) -> String {
        if let Some(custom_title) = parse_custom_title(url) {
            return custom_title;
        }

        let properties = ["property:og:title", "property:og:site_name", "title"];
        let title = properties.iter().find_map(|p| metatags.get(*p));

        match title {
            Some(s) => s.to_string(),
            None => url.to_string(),
        }
    }

    /// Resolve the description from previously-extracted `metatags`: the
    /// first of [`DESCRIPTION_KEYS`] that has text.
    pub fn get_description(metatags: &HashMap<String, String>) -> Option<String> {
        let description = DESCRIPTION_KEYS
            .iter()
            .filter_map(|key| metatags.get(*key))
            .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
            .find(|text| !text.is_empty())?;

        if description.chars().count() <= MAX_DESCRIPTION_CHARS {
            return Some(description);
        }

        let cut: String = description.chars().take(MAX_DESCRIPTION_CHARS).collect();
        Some(format!("{}…", cut.trim_end()))
    }

    /// Build a response by combining the URL and extracted meta tags.
    pub fn new(url: &str, metatags: &HashMap<String, String>) -> Self {
        let title = Self::get_title(url, metatags);
        let description = Self::get_description(metatags);
        let image_url = metatags.get("property:og:image").map(|s| s.to_string());

        let mut favicon_url = metatags.get("favicon").map(|s| s.to_string());

        // Resolve favicon URL to absolute path against the page URL.
        if let Ok(base_url) = Url::parse(url)
            && let Some(furl) = favicon_url.as_deref()
            && let Ok(joined) = base_url.join(furl)
        {
            favicon_url = Some(joined.to_string());
        }

        // Check for embeddable content (video services like Loom, Supercut).
        let (embed_type, embed_url) = match parse_embed_info(url) {
            Some(EmbedInfo {
                embed_type,
                embed_url,
            }) => (embed_type.into(), Some(embed_url)),
            None => (UnfurlEmbedType::None, None),
        };

        GetUnfurlResponse {
            url: url.to_string(),
            title,
            description,
            image_url,
            favicon_url,
            embed_type,
            embed_url,
        }
    }
}

/// Convenience alias for a list of nullable unfurl responses (one entry per
/// requested URL; `None` means the unfurl failed for that URL).
pub type GetUnfurlResponseList = Vec<Option<GetUnfurlResponse>>;

/// Errors that can occur in the unfurl domain.
#[derive(Debug, Error)]
pub enum UnfurlErr {
    /// The underlying fetcher failed to retrieve or parse the page.
    #[error(transparent)]
    Fetch(#[from] anyhow::Error),
}
