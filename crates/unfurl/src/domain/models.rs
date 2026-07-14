//! Domain models for the unfurl crate.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

use super::url_parsers::parse_custom_title;

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
    /// The page description (from `og:description`), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The page's preview image URL (from `og:image`), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    /// The page's favicon URL, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
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

    /// Build a response by combining the URL and extracted meta tags.
    pub fn new(url: &str, metatags: &HashMap<String, String>) -> Self {
        let title = Self::get_title(url, metatags);
        let description = metatags
            .get("property:og:description")
            .map(|s| s.to_string());
        let image_url = metatags.get("property:og:image").map(|s| s.to_string());

        let mut favicon_url = metatags.get("favicon").map(|s| s.to_string());

        // Resolve favicon URL to absolute path against the page URL.
        if let Ok(base_url) = Url::parse(url)
            && let Some(furl) = favicon_url.as_deref()
            && let Ok(joined) = base_url.join(furl)
        {
            favicon_url = Some(joined.to_string());
        }

        GetUnfurlResponse {
            url: url.to_string(),
            title,
            description,
            image_url,
            favicon_url,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_opengraph() {
        let mut tags: HashMap<String, String> = HashMap::new();
        tags.insert("property:og:title".to_string(), "hello".to_string());
        tags.insert(
            "property:og:description".to_string(),
            "this is a description".to_string(),
        );
        tags.insert("property:og:image".to_string(), "foo.jpg".to_string());

        let link = GetUnfurlResponse::new("localhost", &tags);

        assert_eq!(link.url, "localhost");
        assert_eq!(link.title, "hello");
        assert_eq!(link.description.as_deref(), Some("this is a description"));
        assert_eq!(link.image_url.as_deref(), Some("foo.jpg"));
    }

    #[test]
    fn test_og_title_before_sitename() {
        let mut tags = HashMap::new();
        tags.insert(
            "property:og:site_name".to_string(),
            "website title".to_string(),
        );
        tags.insert("property:og:title".to_string(), "hello".to_string());

        let response = GetUnfurlResponse::new("localhost", &tags);
        assert_eq!(response.title, "hello");
    }

    #[test]
    fn test_fallback_to_title_tag() {
        let mut tags = HashMap::new();
        tags.insert("title".to_string(), "Website Title".to_string());

        let response = GetUnfurlResponse::new("localhost", &tags);
        assert_eq!(response.title, "Website Title");
    }

    #[test]
    fn test_custom_url_title_parsing_notion() {
        let empty_tags = HashMap::new();

        let notion_url = "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d";
        assert_eq!(
            GetUnfurlResponse::get_title(notion_url, &empty_tags),
            "Enterprise Product Bottlenecks"
        );

        assert_eq!(
            GetUnfurlResponse::get_title("https://www.notion.so", &empty_tags),
            "Notion"
        );
    }

    #[test]
    fn test_custom_url_falls_back_to_metadata() {
        let mut tags = HashMap::new();
        tags.insert(
            "property:og:title".to_string(),
            "Regular Website Title".to_string(),
        );

        let title = GetUnfurlResponse::get_title("https://example.com/some/page", &tags);
        assert_eq!(title, "Regular Website Title");
    }
}
