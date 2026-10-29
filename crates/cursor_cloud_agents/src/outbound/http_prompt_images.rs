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
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{CONTENT_TYPE, LOCATION};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
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
            .no_proxy()
            .dns_resolver(Arc::new(PublicResolver { allow_loopback }))
            .timeout(FETCH_TIMEOUT)
            .user_agent("macro-cursor-acp")
            .build()
            .expect("the prompt image client uses a valid static TLS configuration");
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
        Box::pin(async move {
            tokio::time::timeout(FETCH_TIMEOUT, self.fetch(url))
                .await
                .ok()
                .flatten()
        })
    }
}

impl HttpPromptImageFetcher {
    #[tracing::instrument(name = "cursor.prompt_image.fetch", skip_all, fields(image.bytes = tracing::field::Empty))]
    async fn fetch(&self, url: &str) -> Option<CursorPromptImage> {
        let mut current = url.to_owned();
        for redirects in 0..=MAX_REDIRECTS {
            if !self.is_public(&current) {
                tracing::debug!("skipping a non-public prompt link");
                return None;
            }
            let mut headers = reqwest::header::HeaderMap::new();
            macro_tower_layers::inject_trace_headers(&mut headers);
            let response = match self.http.get(&current).headers(headers).send().await {
                Ok(response) => response,
                Err(error) => {
                    tracing::debug!(
                        timeout = error.is_timeout(),
                        connect = error.is_connect(),
                        "prompt link could not be fetched"
                    );
                    return None;
                }
            };
            if response.status().is_redirection() {
                if redirects == MAX_REDIRECTS {
                    return None;
                }
                let next = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|location| resolve_redirect(&current, location))?;
                current = next;
                continue;
            }
            if !response.status().is_success() {
                tracing::debug!(status = %response.status(), "prompt link was not an image");
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
                tracing::debug!("prompt image exceeds the size cap");
                return None;
            }
            let bytes = read_capped(response).await?;
            let mime = prompt_image::detect_mime(content_type.as_deref(), &bytes)?;
            if bytes.is_empty() || bytes.len() > prompt_image::MAX_IMAGE_BYTES {
                return None;
            }
            tracing::Span::current().record("image.bytes", bytes.len());
            return Some(CursorPromptImage {
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                mime_type: mime.to_owned(),
                source_url: Some(url.to_owned()),
            });
        }
        None
    }

    fn is_public(&self, raw: &str) -> bool {
        let Ok(url) = Url::parse(raw) else {
            return false;
        };
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return false;
        }
        match url.host() {
            Some(url::Host::Ipv4(ip)) => ip_allowed(IpAddr::V4(ip), self.allow_loopback),
            Some(url::Host::Ipv6(ip)) => ip_allowed(IpAddr::V6(ip), self.allow_loopback),
            Some(url::Host::Domain(host)) => !is_blocked_name(host),
            None => false,
        }
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

// Resolve and validate the very addresses reqwest connects to, rather than
// validating a separate DNS lookup which can change before the connection.
struct PublicResolver {
    allow_loopback: bool,
}

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let allow_loopback = self.allow_loopback;
        Box::pin(async move {
            let addresses: Vec<SocketAddr> =
                tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            if addresses.is_empty()
                || addresses
                    .iter()
                    .any(|addr| !ip_allowed(addr.ip(), allow_loopback))
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "non-public image address",
                )
                .into());
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

fn ip_allowed(ip: IpAddr, allow_loopback: bool) -> bool {
    if allow_loopback && ip.is_loopback() {
        return true;
    }
    !is_private_ip(ip)
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || v4.octets()[0] == 0
                || v4.octets()[0] >= 240
                || (v4.octets()[0] == 100 && (64..=127).contains(&v4.octets()[1]))
                || (v4.octets()[0] == 198 && matches!(v4.octets()[1], 18 | 19))
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(mapped));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xe000) != 0x2000
                || (v6.segments()[0] == 0x2001 && v6.segments()[1] == 0x0db8)
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
