use anyhow::Error;
use futures::StreamExt;
use scraper::{Html, Selector};
use std::collections::HashMap;
use url::Url;

use crate::http_safety::{
    FetchError, assert_not_internal, check_content_length, content_type_of, send_request,
    validate_url,
};

pub use ::unfurl::domain::favicon::append_optimistic_favico;
pub use ::unfurl::domain::models::{GetUnfurlResponse, GetUnfurlResponseList};

// Re-exported through `crate::unfurl_service::{favico_url, url_parsers}` for
// external consumers (see `lib.rs`). Not consumed inside this binary itself,
// so the bin target sees them as unused without the allow.
#[allow(unused_imports)]
pub use ::unfurl::domain::favicon::favico_url;
#[allow(unused_imports)]
pub use ::unfurl::domain::url_parsers;

/// 1 MB max HTML response size for meta-tag extraction.
pub const MAX_HTML_SIZE: u64 = 1024 * 1024;

/// Cap on concurrent outbound requests for `fetch_links_async`.
pub const BULK_CONCURRENCY: usize = 16;

#[tracing::instrument]
fn parse_document(html_content: &str, url: &Url) -> Result<HashMap<String, String>, Error> {
    fn no_tag(tag: &str) -> Error {
        anyhow::anyhow!(format!("Missing expected tag: [{}]", tag))
    }

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

#[derive(Debug)]
pub enum UnfurlFetchError {
    Fetch(FetchError),
    Parse(Error),
}

impl std::fmt::Display for UnfurlFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fetch(e) => write!(f, "{e}"),
            Self::Parse(e) => write!(f, "{e}"),
        }
    }
}

impl From<FetchError> for UnfurlFetchError {
    fn from(e: FetchError) -> Self {
        Self::Fetch(e)
    }
}

#[tracing::instrument(err(Debug), skip(client))]
pub async fn extract_meta_tags_prod(
    client: &reqwest::Client,
    raw_url: &str,
) -> Result<HashMap<String, String>, UnfurlFetchError> {
    let url = validate_url(raw_url)?;
    assert_not_internal(&url).await?;

    let response = send_request(client, &url).await?;

    let content_type = content_type_of(&response);
    if !is_html_content_type(&content_type) {
        return Err(FetchError::UnexpectedContentType(content_type).into());
    }

    check_content_length(&response, MAX_HTML_SIZE, raw_url)?;

    let html_content = read_body_capped(response, MAX_HTML_SIZE).await?;

    let meta_tags = parse_document(&html_content, &url).map_err(UnfurlFetchError::Parse)?;

    Ok(meta_tags)
}

fn is_html_content_type(content_type: &str) -> bool {
    // `content_type` may include charset, e.g. "text/html; charset=utf-8".
    let primary = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    primary == "text/html" || primary == "application/xhtml+xml"
}

async fn read_body_capped(
    response: reqwest::Response,
    max: u64,
) -> Result<String, UnfurlFetchError> {
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let chain = crate::http_safety::build_error_chain(&e);
            tracing::warn!(error = %chain, "error reading unfurl response body");
            UnfurlFetchError::Fetch(FetchError::ResponseRead(chain))
        })?;
        if (buf.len() as u64) + (chunk.len() as u64) > max {
            tracing::warn!(max, "unfurl response exceeded max size during streaming");
            return Err(UnfurlFetchError::Fetch(FetchError::ResponseTooLarge {
                content_length: (buf.len() as u64) + (chunk.len() as u64),
                max,
            }));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|e| {
        UnfurlFetchError::Fetch(FetchError::ResponseRead(format!(
            "response body was not valid UTF-8: {e}"
        )))
    })
}

pub async fn extract_meta_tags(
    client: &reqwest::Client,
    url: &str,
) -> Result<HashMap<String, String>, UnfurlFetchError> {
    if cfg!(feature = "mock") {
        extract_meta_tags_mock(url).await
    } else {
        extract_meta_tags_prod(client, url).await
    }
}

pub async fn extract_meta_tags_mock(
    url: &str,
) -> Result<HashMap<String, String>, UnfurlFetchError> {
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

    Err(UnfurlFetchError::Parse(anyhow::anyhow!("not found")))
}

pub async fn fetch_links_async(
    client: &reqwest::Client,
    links: &[String],
) -> GetUnfurlResponseList {
    futures::stream::iter(links.iter().cloned())
        .map(|url| {
            let client = client.clone();
            async move {
                match extract_meta_tags(&client, &url).await {
                    Ok(tags) => {
                        let tags = append_optimistic_favico(tags, &url);
                        Some(GetUnfurlResponse::new(&url, &tags))
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, url = %url, "bulk unfurl failed for url");
                        None
                    }
                }
            }
        })
        .buffered(BULK_CONCURRENCY)
        .collect()
        .await
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
        let client = reqwest::Client::new();
        let tags = extract_meta_tags(&client, "https://hello.com")
            .await
            .unwrap();
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

    #[test]
    fn test_is_html_content_type() {
        assert!(is_html_content_type("text/html"));
        assert!(is_html_content_type("text/html; charset=utf-8"));
        assert!(is_html_content_type("application/xhtml+xml"));
        assert!(!is_html_content_type("image/png"));
        assert!(!is_html_content_type("application/json"));
    }
}
