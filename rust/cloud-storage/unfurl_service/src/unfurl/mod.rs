pub mod url_parsers;

use anyhow::{Context, Error};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use url::Url;
use utoipa::ToSchema;

use url_parsers::parse_custom_title;

pub type GetUnfurlResponseList = Vec<Option<GetUnfurlResponse>>;

#[derive(Debug, Serialize, Deserialize, ToSchema, Default, Clone, Eq, PartialEq)]
pub struct GetUnfurlResponse {
    pub url: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
}

#[cfg_attr(feature = "mock", expect(dead_code))]
fn no_tag(tag: &str) -> Error {
    anyhow::anyhow!(format!("Missing expected tag: [{}]", tag))
}

#[tracing::instrument]
fn parse_document(html_content: &str, url: &Url) -> Result<HashMap<String, String>, Error> {
    // Parse the HTML document
    let document = Html::parse_document(html_content);

    // Create a selector for meta tags
    let meta_selector = Selector::parse("meta").map_err(|_| no_tag("meta"))?;

    // HashMap to store meta tags
    let mut meta_tags = HashMap::new();

    // Find all meta tags
    for element in document.select(&meta_selector) {
        // Try to get name attribute
        if let Some(name) = element.value().attr("name")
            && let Some(content) = element.value().attr("content")
        {
            meta_tags.insert(format!("name:{}", name), content.to_string());
        }

        // Try to get property attribute (for Open Graph and other meta tags)
        if let Some(property) = element.value().attr("property")
            && let Some(content) = element.value().attr("content")
        {
            meta_tags.insert(format!("property:{}", property), content.to_string());
        }
    }

    let title_tag = Selector::parse("title").map_err(|_| no_tag("title"))?;
    for element in document.select(&title_tag) {
        meta_tags.insert("title".to_string(), element.inner_html());
    }

    if let Some(favicon) = find_favicon(&document, url) {
        meta_tags.insert("favicon".to_string(), favicon);
    }
    Ok(meta_tags)
}

#[cfg_attr(feature = "mock", expect(dead_code))]
fn find_favicon(document: &Html, base_url: &Url) -> Option<String> {
    let links_selector = Selector::parse("link").ok()?;

    for element in document.select(&links_selector) {
        if let Some(rel) = element.value().attr("rel")
            && rel
                .split_whitespace()
                .any(|r| r.to_lowercase().contains("icon"))
            && let Some(href) = element.value().attr("href")
        {
            // Make the favicon URL absolute
            if let Ok(abs_url) = base_url.join(href) {
                return Some(abs_url.to_string());
            } else {
                // href might already be absolute, just return it
                return Some(href.to_string());
            }
        }
    }

    None
}
#[cfg(not(feature = "mock"))]
#[tracing::instrument]
pub async fn extract_meta_tags(
    url: &str,
) -> Result<HashMap<String, String>, Box<dyn std::error::Error + Send + Sync>> {
    // Fetch the HTML content
    // TODO: how to handle malicious input?

    use http::StatusCode;
    let url = Url::parse(url).context("invalid url")?;

    let response = reqwest::get(url.clone()).await?;
    if response.status() != StatusCode::OK {
        return Err(anyhow::anyhow!("Site refused with code: {}", response.status()).into());
    }
    let html_content = response.text().await?;
    let meta_tags = parse_document(&html_content, &url)?;

    Ok(meta_tags)
}

pub fn favico_url(url: &str) -> Result<String, anyhow::Error> {
    let url = Url::parse(url).context("failed to parse url")?;
    let host = url.host().ok_or_else(|| anyhow::anyhow!("no host"))?;
    let scheme = url.scheme();
    let port = url
        .port()
        .map(|port| format!(":{}", port))
        .unwrap_or_default();
    Ok(format!("{}://{}{}/favicon.ico", scheme, port, host))
}

pub fn append_optimistic_favico(
    mut meta_tags: HashMap<String, String>,
    url: &str,
) -> HashMap<String, String> {
    let optimistic_url = favico_url(url)
        .inspect_err(|err| tracing::debug!(error=?err, "could not form favicon url"));

    if !meta_tags.contains_key("favicon")
        && let Ok(url) = optimistic_url
    {
        meta_tags.insert("favicon".to_string(), url);
    }

    meta_tags
}

#[cfg(feature = "mock")]
pub async fn extract_meta_tags(
    url: &str,
) -> Result<HashMap<String, String>, Box<dyn std::error::Error>> {
    if url == "https://hello.com" {
        let mut m = HashMap::new();
        m.insert("property:og:title".to_string(), "Hello".to_string());
        m.insert(
            "property:og:description".to_string(),
            "This is a description.".to_string(),
        );
        return Ok(m);
    }

    if url == "https://example.com" {
        let mut m = HashMap::new();
        m.insert(
            "property:og:title".to_string(),
            "Example Website".to_string(),
        );
        m.insert(
            "property:og:description".to_string(),
            "This is an example website.".to_string(),
        );
        return Ok(m);
    }

    Err("not found".into())
}

impl GetUnfurlResponse {
    pub fn get_title(url: &str, metatags: &HashMap<String, String>) -> String {
        // First try custom URL parsing for known services
        if let Some(custom_title) = parse_custom_title(url) {
            return custom_title;
        }

        // Fall back to metadata extraction
        let mut title = None;

        let properties = ["property:og:title", "property:og:site_name", "title"];

        for prop in properties {
            title = metatags.get(prop);
            if title.is_some() {
                break;
            }
        }

        let title = match title {
            Some(s) => s,
            None => url,
        };

        title.to_string()
    }

    pub fn new(url: &str, metatags: &HashMap<String, String>) -> Self {
        let title = Self::get_title(url, metatags);

        let description = metatags
            .get("property:og:description")
            .map(|s| s.to_string());

        // TODO: prioritize ol:image:secure_url over og:image if both exist
        let image_url = metatags.get("property:og:image").map(|s| s.to_string());

        let mut favicon_url = metatags.get("favicon").map(|s| s.to_string());

        // Resolve favicon URL to absolute path
        if let Ok(base_url) = Url::parse(url)
            && let Some(furl) = favicon_url
        {
            // TODO: better error handling?
            let base_url = base_url.join(&furl).unwrap();
            favicon_url = Some(base_url.to_string());
        }

        GetUnfurlResponse {
            url: url.to_string(),
            title: title.to_string(),
            description,
            image_url,
            favicon_url,
        }
    }
}

pub async fn fetch_links_async(links: &[String]) -> GetUnfurlResponseList {
    let futures = links.iter().map(|url| async move {
        extract_meta_tags(url)
            .await
            .ok()
            .map(|tags| append_optimistic_favico(tags, url))
            .map(|tags| GetUnfurlResponse::new(url, &tags))
    });

    futures::future::join_all(futures).await
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;
    #[test]
    fn test_parse_document() {
        let document_content = [
            "<html>",
            "<head>",
            "<meta property=\"og:title\" content=\"hello\" /> ",
            "</head>",
            "</html>",
        ]
        .join("\n");
        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        assert!(tags.contains_key("property:og:title"));

        let val = tags.get("property:og:title").unwrap();

        assert_eq!(val, "hello");
    }

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
        assert!(link.description.is_some());
        assert_eq!(link.description.unwrap(), "this is a description");
        assert!(link.image_url.is_some());
        assert_eq!(link.image_url.unwrap(), "foo.jpg");
    }

    // use og:site_name as fallback for title
    #[test]
    fn test_extract_site_name() {
        let document_content = [
            "<html>",
            "<head>",
            "<meta property=\"og:site_name\" content=\"website title\" /> ",
            "</head>",
            "</html>",
        ]
        .join("\n");

        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        let response = GetUnfurlResponse::new("localhost", &tags);

        assert_eq!(response.title, "website title");
    }

    // make sure og:title has precedence over the title
    #[test]
    fn test_og_title_before_sitename() {
        let document_content = [
            "<html>",
            "<head>",
            "<meta property=\"og:site_name\" content=\"website title\" /> ",
            "<meta property=\"og:title\" content=\"hello\" /> ",
            "</head>",
            "</html>",
        ]
        .join("\n");

        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        let response = GetUnfurlResponse::new("localhost", &tags);

        assert_eq!(response.title, "hello");
    }

    // make sure the extractor sees the title tag and stores it in the hashmap
    #[test]
    fn test_title_in_tags() {
        let document_content = [
            "<html>",
            "<head>",
            "<title>Website Title</title>",
            "</head>",
            "</html>",
        ]
        .join("\n");

        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        assert!(tags.contains_key("title"));
    }

    // In a minimal document with no metadata, but a title element
    // make sure that is set to be title
    #[test]
    fn test_fallback_to_title() {
        let document_content = [
            "<html>",
            "<head>",
            "<title>Website Title</title>",
            "</head>",
            "</html>",
        ]
        .join("\n");
        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        let response = GetUnfurlResponse::new("localhost", &tags);

        assert_eq!(response.title, "Website Title");
    }

    // favicon support
    #[ignore]
    #[test]
    fn test_favicon() {
        let document_content = [
            "<html>",
            "<head>",
            "<title>Website Title</title>",
            "<link rel=\"icon\" href=\"/static/favicon/wikipedia.ico\">",
            "</head>",
            "</html>",
        ]
        .join("\n");
        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        let url = "https://en.wikipedia.org/wiki/List_of_HTTP_status_codes";
        let expected_favicon_url = "https://en.wikipedia.org/static/favicon/wikipedia.ico";
        let response = GetUnfurlResponse::new(url, &tags);

        assert!(response.favicon_url.is_some());
        assert_eq!(response.favicon_url.unwrap(), expected_favicon_url);
    }

    // assumes mock feature is enabled, just a way to make sure mock
    // data is assuming as expected
    #[cfg(feature = "mock")]
    #[tokio::test]
    async fn test_extract_meta_tags_mock() {
        let tags = extract_meta_tags("https://hello.com").await.unwrap();
        assert!(tags.contains_key("property:og:title"));
        let title = tags.get("property:og:title").unwrap();
        assert_eq!(title, "Hello");
    }

    #[test]
    fn test_custom_url_title_parsing_notion() {
        let empty_tags = HashMap::new();

        // Test Notion URLs
        let notion_url1 = "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d";
        let title1 = GetUnfurlResponse::get_title(notion_url1, &empty_tags);
        assert_eq!(title1, "Enterprise Product Bottlenecks");

        let notion_url2 =
            "https://www.notion.so/Macro-Work-Thoughts-e52b32630b2e45fab665b3e5c566cf3b";
        let title2 = GetUnfurlResponse::get_title(notion_url2, &empty_tags);
        assert_eq!(title2, "Macro Work Thoughts");

        let notion_url3 = "https://www.notion.so/craft-ventures/Craft-Ventures-Operating-Playbooks-9db7bdccfc0f47be96076c122513691c";
        let title3 = GetUnfurlResponse::get_title(notion_url3, &empty_tags);
        assert_eq!(title3, "Craft Ventures Operating Playbooks");

        // Test fallback for invalid Notion URL
        let notion_fallback = "https://www.notion.so";
        let title_fallback = GetUnfurlResponse::get_title(notion_fallback, &empty_tags);
        assert_eq!(title_fallback, "Notion");
    }

    #[test]
    fn test_custom_url_title_parsing_figma() {
        let empty_tags = HashMap::new();

        // Test Figma URLs
        let figma_url1 = "https://www.figma.com/design/Kf1Vep5riU3re2GO4E0q6b/Peter-Copy-of-Paper-Crowns?node-id=0-1&p=f&t=Z2dZh8AyxauKitCl-0";
        let title1 = GetUnfurlResponse::get_title(figma_url1, &empty_tags);
        assert_eq!(title1, "Peter Copy Of Paper Crowns");

        let figma_url2 = "https://www.figma.com/design/VWgAP7zMauuWKkeS3CmWk3/AI-side-panel?node-id=0-1&p=f&t=SqdP6D2w2rZ5iSjV-0";
        let title2 = GetUnfurlResponse::get_title(figma_url2, &empty_tags);
        assert_eq!(title2, "AI Side Panel");

        // Test fallback for invalid Figma URL
        let figma_fallback = "https://www.figma.com";
        let title_fallback = GetUnfurlResponse::get_title(figma_fallback, &empty_tags);
        assert_eq!(title_fallback, "Figma");
    }

    #[test]
    fn test_custom_url_title_parsing_linear() {
        let empty_tags = HashMap::new();

        // Test Linear URLs
        let linear_url1 = "https://linear.app/macro-eng/issue/M-3586/ability-to-archive-emails";
        let title1 = GetUnfurlResponse::get_title(linear_url1, &empty_tags);
        assert_eq!(title1, "Ability To Archive Emails");

        let linear_url2 =
            "https://linear.app/macro-eng/issue/M-3421/add-macro-permissions-to-jwt-token";
        let title2 = GetUnfurlResponse::get_title(linear_url2, &empty_tags);
        assert_eq!(title2, "Add Macro Permissions To Jwt Token");

        // Test fallback for invalid Linear URL
        let linear_fallback = "https://linear.app";
        let title_fallback = GetUnfurlResponse::get_title(linear_fallback, &empty_tags);
        assert_eq!(title_fallback, "Linear");
    }

    #[test]
    fn test_custom_url_title_parsing_fallback_to_metadata() {
        // Test that for non-special URLs, it still falls back to metadata
        let mut tags = HashMap::new();
        tags.insert(
            "property:og:title".to_string(),
            "Regular Website Title".to_string(),
        );

        let regular_url = "https://example.com/some/page";
        let title = GetUnfurlResponse::get_title(regular_url, &tags);
        assert_eq!(title, "Regular Website Title");
    }
}
