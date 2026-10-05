//! Fetches a pasted link and keeps it when the response is a raster image.
//!
//! Cursor can be handed a URL and fetch it itself. We fetch first because the
//! link does not say that it is an image, and because the bytes are what the
//! ACP image frame and `prompt.images.data` both need.

#[cfg(test)]
mod test;

use crate::domain::ports::PromptImageFetcher;
use crate::domain::prompt_image::{self, CursorPromptImage};
use base64::Engine as _;
use futures::StreamExt as _;
use futures::future::BoxFuture;
use reqwest::Url;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use std::net::IpAddr;
use std::time::Duration;

/// How long one link may take, redirects included.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Redirects followed before giving up on the link.
const MAX_REDIRECTS: usize = 5;

/// Fetches prompt images over HTTP.
#[derive(Debug, Clone)]
pub struct HttpPromptImageFetcher {
    http: reqwest::Client,
    /// Loopback is a test stand-in. Production leaves it blocked.
    allow_loopback: bool,
}

impl HttpPromptImageFetcher {
    /// A fetcher that refuses private and loopback addresses.
    #[must_use]
    pub fn new() -> Self {
        Self::build(false)
    }

    fn build(allow_loopback: bool) -> Self {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(FETCH_TIMEOUT)
            .user_agent("macro-cursor-acp")
            .build()
            .expect("reqwest client");
        Self {
            http,
            allow_loopback,
        }
    }
}

impl Default for HttpPromptImageFetcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl HttpPromptImageFetcher {
    /// Lets a test stand-in on loopback answer. Production construction does
    /// not.
    fn allowing_loopback() -> Self {
        Self::build(true)
    }
}

impl PromptImageFetcher for HttpPromptImageFetcher {
    fn fetch_image<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Option<CursorPromptImage>> {
        Box::pin(async move { self.fetch(url).await })
    }
}

impl HttpPromptImageFetcher {
    async fn fetch(&self, url: &str) -> Option<CursorPromptImage> {
        let mut current = url.to_owned();
        for _ in 0..MAX_REDIRECTS {
            if !self.is_public(&current).await {
                tracing::info!(url = %current, "skipping a prompt link that is not a public http url");
                return None;
            }
            let response = match self.http.get(&current).send().await {
                Ok(response) => response,
                Err(error) => {
                    tracing::info!(url = %current, error = %error, "prompt link could not be fetched");
                    return None;
                }
            };
            if response.status().is_redirection() {
                let Some(next) = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|location| resolve_redirect(&current, location))
                else {
                    return None;
                };
                current = next;
                continue;
            }
            if !response.status().is_success() {
                tracing::info!(url = %current, status = %response.status(), "prompt link was not an image");
                return None;
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            if !prompt_image::worth_fetching(content_type.as_deref()) {
                return None;
            }
            if response
                .content_length()
                .is_some_and(|len| len > prompt_image::MAX_IMAGE_BYTES as u64)
            {
                tracing::info!(url = %current, "prompt image is over Cursor's size cap");
                return None;
            }
            let bytes = read_capped(response).await?;
            let mime = prompt_image::detect_mime(content_type.as_deref(), &bytes)?;
            if bytes.is_empty() || bytes.len() > prompt_image::MAX_IMAGE_BYTES {
                return None;
            }
            return Some(CursorPromptImage {
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                mime_type: mime.to_owned(),
                source_url: Some(url.to_owned()),
            });
        }
        None
    }

    async fn is_public(&self, raw: &str) -> bool {
        let Ok(url) = Url::parse(raw) else {
            return false;
        };
        if url.scheme() != "http" && url.scheme() != "https" {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        if is_blocked_name(host) {
            return false;
        }
        if let Ok(ip) = host.parse::<IpAddr>() {
            return self.ip_allowed(ip);
        }
        let port = url.port_or_known_default().unwrap_or(80);
        let Ok(addrs) = tokio::net::lookup_host((host, port)).await else {
            return false;
        };
        let mut saw_one = false;
        for addr in addrs {
            saw_one = true;
            if !self.ip_allowed(addr.ip()) {
                return false;
            }
        }
        saw_one
    }

    fn ip_allowed(&self, ip: IpAddr) -> bool {
        if self.allow_loopback && ip.is_loopback() {
            return true;
        }
        !is_private_ip(ip)
    }
}

fn is_blocked_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host == "metadata.google.internal"
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(mapped));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

fn resolve_redirect(current: &str, location: &str) -> Option<String> {
    let base = Url::parse(current).ok()?;
    base.join(location).ok().map(|url| url.to_string())
}

async fn read_capped(response: reqwest::Response) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if body.len().saturating_add(chunk.len()) > prompt_image::MAX_IMAGE_BYTES {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}
