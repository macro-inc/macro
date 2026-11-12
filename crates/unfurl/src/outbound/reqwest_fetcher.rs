//! Reqwest + scraper-backed adapter implementing [`UnfurlFetcher`].

use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use scraper::{ElementRef, Html, Selector};
use thiserror::Error;
use tracing::Level;
use url::Url;

use super::http_safety::{
    FetchError, assert_not_internal, build_error_chain, content_type_of, redirect_target,
    send_request, validate_url,
};
use super::resolver::PrivateIpFilteringResolver;
use crate::domain::models::FIRST_PARAGRAPH_KEY;
use crate::domain::ports::UnfurlFetcher;

#[cfg(test)]
mod test;

/// How much of a page is read for its tags: the first 1 MB. Longer pages are
/// cut there, not refused; a video page can run past it and still name itself
/// well within it.
const MAX_HTML_SIZE: usize = 1024 * 1024;

/// Shortest paragraph taken as a page's description. Shorter ones are
/// bylines, captions, and labels.
const MIN_PARAGRAPH_CHARS: usize = 80;

/// Maximum number of redirects to follow per unfurl fetch. Matches the
/// previous reqwest-managed `Policy::limited(5)` behaviour.
const MAX_REDIRECTS: u8 = 5;

/// Default request timeout for an unfurl fetch.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// Default connect timeout for an unfurl fetch.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Identifies the fetcher to the sites it reads. Some sites refuse requests
/// that carry no user agent, and reqwest sends none by default.
const USER_AGENT: &str = "Mozilla/5.0 (compatible; MacroBot/1.0; +https://macro.com)";

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
            .no_proxy()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .user_agent(USER_AGENT)
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

#[tracing::instrument(err(Debug, level = Level::DEBUG), skip(client))]
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

    let html_content = read_body_start(response, MAX_HTML_SIZE).await?;

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

/// The first `max` bytes of the response body, as text.
async fn read_body_start(
    response: reqwest::Response,
    max: usize,
) -> Result<String, UnfurlFetchError> {
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut cut = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let chain = build_error_chain(&e);
            tracing::warn!(error = %chain, "error reading unfurl response body");
            UnfurlFetchError::Fetch(FetchError::ResponseRead(chain))
        })?;
        let room = max - buf.len();
        buf.extend(chunk.iter().take(room));
        if chunk.len() > room {
            cut = true;
            break;
        }
    }
    text_from_utf8(buf, cut)
}

/// Decode a body read from the start of a response. A body `cut` short may
/// end inside a character, which is dropped; any other invalid UTF-8 fails.
fn text_from_utf8(mut bytes: Vec<u8>, cut: bool) -> Result<String, UnfurlFetchError> {
    if cut
        && let Err(error) = std::str::from_utf8(&bytes)
        && error.error_len().is_none()
    {
        bytes.truncate(error.valid_up_to());
    }

    String::from_utf8(bytes).map_err(|e| {
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

    // The document's own title: an inline SVG further down can carry a
    // `<title>` too, naming a logo.
    let title_tag = Selector::parse("head > title").map_err(|_| no_tag("title"))?;
    if let Some(element) = document.select(&title_tag).next() {
        meta_tags.insert("title".to_string(), element.text().collect());
    }

    if let Some(favicon) = find_favicon(&document, url) {
        meta_tags.insert("favicon".to_string(), favicon);
    }

    if let Some(paragraph) = find_first_paragraph(&document) {
        meta_tags.insert(FIRST_PARAGRAPH_KEY.to_string(), paragraph);
    }
    Ok(meta_tags)
}

/// The first paragraph of the page's main content, for pages whose head does
/// not say what they are about.
fn find_first_paragraph(document: &Html) -> Option<String> {
    let paragraphs = Selector::parse(r#"main p, article p, [role="main"] p"#).ok()?;

    document
        .select(&paragraphs)
        .map(paragraph_text)
        .find(|text| text.chars().count() >= MIN_PARAGRAPH_CHARS)
}

/// A paragraph's text as its reader sees it, on one line: without footnote
/// markers, or the styles and scripts a page embeds in its text.
fn paragraph_text(paragraph: ElementRef<'_>) -> String {
    let mut text = String::new();

    for node in paragraph.descendants() {
        let Some(fragment) = node.value().as_text() else {
            continue;
        };

        let unseen = node
            .ancestors()
            .take_while(|ancestor| ancestor.id() != paragraph.id())
            .filter_map(|ancestor| ancestor.value().as_element())
            .any(|element| matches!(element.name(), "sup" | "style" | "script"));
        if !unseen {
            text.push_str(fragment);
        }
    }

    text.split_whitespace().collect::<Vec<_>>().join(" ")
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
