//! Reqwest + scraper-backed adapter implementing [`UnfurlFetcher`].

use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use scraper::{Html, Selector};
use thiserror::Error;
use url::Url;

use super::http_safety::{
    FetchError, assert_not_internal, build_error_chain, check_content_length, content_type_of,
    redirect_target, send_request, validate_url,
};
use super::resolver::PrivateIpFilteringResolver;
use crate::domain::ports::UnfurlFetcher;

/// 1 MB cap on HTML response size for meta-tag extraction.
const MAX_HTML_SIZE: u64 = 1024 * 1024;

/// Maximum number of redirects to follow per unfurl fetch. Matches the
/// previous reqwest-managed `Policy::limited(5)` behaviour.
const MAX_REDIRECTS: u8 = 5;

/// Default request timeout for an unfurl fetch.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// Default connect timeout for an unfurl fetch.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Concrete [`UnfurlFetcher`] backed by a `reqwest::Client` and the
/// `scraper` HTML parser.
///
/// SSRF mitigations baked into the client:
///
/// 1. **Redirects disabled** at the reqwest level so the manual loop in
///    [`extract_meta_tags`] can run [`assert_not_internal`] on every hop
///    and follows up to [`MAX_REDIRECTS`] redirects itself.
/// 2. **Private-IP-filtering DNS resolver** ([`PrivateIpFilteringResolver`])
///    enforces the same private-IP check at the moment reqwest actually
///    connects, closing the DNS-rebinding TOCTOU window where the preflight
///    and the connect attempt could see different answers from the
///    authoritative DNS server.
pub struct ReqwestUnfurlFetcher {
    client: reqwest::Client,
}

impl ReqwestUnfurlFetcher {
    /// Build a fetcher with a dedicated HTTP client.
    ///
    /// Owning the client construction keeps the SSRF mitigation
    /// (no reqwest-level redirect-follow + per-hop internal-IP preflight +
    /// rebinding-safe DNS resolver) inseparable from the fetcher's type —
    /// callers can't accidentally hand in a redirect-following or
    /// unfiltered client.
    pub fn new() -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(PrivateIpFilteringResolver))
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()?;
        Ok(Self { client })
    }
}

impl UnfurlFetcher for ReqwestUnfurlFetcher {
    type Err = anyhow::Error;

    async fn fetch_meta_tags(&self, url: &str) -> Result<HashMap<String, String>, Self::Err> {
        extract_meta_tags(&self.client, url)
            .await
            .map_err(anyhow::Error::from)
    }
}

#[derive(Debug, Error)]
enum UnfurlFetchError {
    #[error(transparent)]
    Fetch(#[from] FetchError),
    #[error("failed to parse document: {0}")]
    Parse(anyhow::Error),
}

#[tracing::instrument(err(Debug), skip(client))]
async fn extract_meta_tags(
    client: &reqwest::Client,
    raw_url: &str,
) -> Result<HashMap<String, String>, UnfurlFetchError> {
    let mut url = validate_url(raw_url)?;
    let mut redirects_remaining = MAX_REDIRECTS;

    let response = loop {
        assert_not_internal(&url).await?;
        let response = send_request(client, &url).await?;
        let status = response.status();

        if status.is_redirection() {
            if redirects_remaining == 0 {
                return Err(FetchError::UpstreamRedirect(format!(
                    "exceeded maximum of {MAX_REDIRECTS} redirects"
                ))
                .into());
            }
            let next = redirect_target(&url, &response)?;
            tracing::debug!(from = %url, to = %next, "following redirect");
            redirects_remaining -= 1;
            url = next;
            continue;
        }

        if !status.is_success() {
            return Err(FetchError::UpstreamStatus(status).into());
        }

        break response;
    };

    let content_type = content_type_of(&response);
    if !is_html_content_type(&content_type) {
        return Err(FetchError::UnexpectedContentType(content_type).into());
    }

    check_content_length(&response, MAX_HTML_SIZE, raw_url)?;

    let html_content = read_body_capped(response, MAX_HTML_SIZE).await?;

    parse_document(&html_content, &url).map_err(UnfurlFetchError::Parse)
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
            let chain = build_error_chain(&e);
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

#[tracing::instrument(skip(html_content))]
fn parse_document(html_content: &str, url: &Url) -> Result<HashMap<String, String>, anyhow::Error> {
    fn no_tag(tag: &str) -> anyhow::Error {
        anyhow::anyhow!("Missing expected tag: [{tag}]")
    }

    let document = Html::parse_document(html_content);

    let meta_selector = Selector::parse("meta").map_err(|_| no_tag("meta"))?;

    let mut meta_tags = HashMap::new();

    for element in document.select(&meta_selector) {
        if let Some(name) = element.value().attr("name")
            && let Some(content) = element.value().attr("content")
        {
            meta_tags.insert(format!("name:{name}"), content.to_string());
        }

        if let Some(property) = element.value().attr("property")
            && let Some(content) = element.value().attr("content")
        {
            meta_tags.insert(format!("property:{property}"), content.to_string());
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
            if let Ok(abs_url) = base_url.join(href) {
                return Some(abs_url.to_string());
            } else {
                return Some(href.to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[test]
    fn test_parse_document_extracts_og_title() {
        let document_content = [
            "<html>",
            "<head>",
            "<meta property=\"og:title\" content=\"hello\" />",
            "</head>",
            "</html>",
        ]
        .join("\n");
        let url = Url::from_str("http://example.com").unwrap();
        let tags = parse_document(&document_content, &url).unwrap();

        assert_eq!(
            tags.get("property:og:title").map(String::as_str),
            Some("hello")
        );
    }

    #[test]
    fn test_parse_document_extracts_title_tag() {
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
        assert_eq!(tags.get("title").map(String::as_str), Some("Website Title"));
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
