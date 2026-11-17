//! The fetch itself: URL checks, the redirect loop, and response checks.

use std::sync::Arc;

use reqwest::StatusCode;
use reqwest::header::{CONTENT_TYPE, HeaderMap, LOCATION};
use tokio::time::Instant;
use tracing::{Instrument, Level};
use url::{Host, Url};

use crate::body::SafeBody;
use crate::error::{BuildError, FetchError};
use crate::policy::{FetchPolicy, MediaType, Scheme};
use crate::resolver::{GuardedResolver, HostLookup, SystemLookup};

/// Fetches URLs that someone outside Macro chose (a user, an agent, an email,
/// a webhook config) without letting them reach internal addresses or tie up
/// the service. Cheap to clone; build one at startup and share it.
#[derive(Clone)]
pub struct SafeFetcher {
    client: reqwest::Client,
    policy: Arc<FetchPolicy>,
}

/// A successful (2xx) response whose headers passed the policy. The body is
/// still unread; [`SafeBody`] enforces the size and time limits as it is read.
#[derive(Debug)]
pub struct SafeResponse {
    /// The upstream status, always 2xx.
    pub status: StatusCode,
    /// The upstream response headers.
    pub headers: HeaderMap,
    /// The URL that answered, after redirects.
    pub final_url: Url,
    /// The declared media type, one the policy accepts.
    pub media_type: MediaType,
    /// The body, limited by the policy.
    pub body: SafeBody,
}

impl SafeFetcher {
    /// A fetcher resolving names through the operating system.
    pub fn new(policy: FetchPolicy) -> Result<Self, BuildError> {
        Self::with_lookup(policy, SystemLookup)
    }

    /// A fetcher resolving names through `lookup`. Tests use this to serve
    /// chosen (and changing) DNS answers.
    pub fn with_lookup(policy: FetchPolicy, lookup: impl HostLookup) -> Result<Self, BuildError> {
        let resolver = GuardedResolver::new(Arc::new(lookup), policy.addresses.clone());

        // Each setting closes a hole a default client leaves open:
        // - redirects are followed by `get` itself, so every hop is checked;
        // - system proxies (HTTP_PROXY and friends) would connect to the proxy
        //   and leave the address check meaningless;
        // - `Referer` would tell the next hop the previous URL, query and all.
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .referer(false)
            .connect_timeout(policy.connect_timeout)
            .dns_resolver(Arc::new(resolver))
            .build()?;

        Ok(Self {
            client,
            policy: Arc::new(policy),
        })
    }

    /// GET `url`, following redirects the policy allows.
    ///
    /// `headers` are sent on the first hop and on redirects that stay on the
    /// same origin; a redirect to another origin drops them, so credentials
    /// meant for one host never reach the next. No trace context is sent:
    /// these are third-party hosts.
    #[tracing::instrument(
        name = "safe_fetch.fetch",
        skip_all,
        err(level = Level::WARN),
        fields(
            url.scheme = tracing::field::Empty,
            server.address = tracing::field::Empty,
            server.port = tracing::field::Empty,
            safe_fetch.redirects = tracing::field::Empty,
            http.response.status_code = tracing::field::Empty,
            safe_fetch.error_kind = tracing::field::Empty,
        )
    )]
    pub async fn get(&self, url: &str, headers: HeaderMap) -> Result<SafeResponse, FetchError> {
        let result = self.fetch(url, headers).await;
        if let Err(error) = &result {
            tracing::Span::current().record("safe_fetch.error_kind", error.kind());
        }
        result
    }

    /// Send `url`, following redirects the policy allows, and return the
    /// final URL with its response. Counts hops into `redirects` so the
    /// caller can record the count on every outcome.
    async fn follow_redirects(
        &self,
        mut url: Url,
        headers: &HeaderMap,
        deadline: Instant,
        redirects: &mut u8,
    ) -> Result<(Url, reqwest::Response), FetchError> {
        let first_origin = url.origin();
        loop {
            let hop_headers = if url.origin() == first_origin {
                headers.clone()
            } else {
                HeaderMap::new()
            };

            let response = self.send(&url, hop_headers, deadline).await?;
            let status = response.status();

            if !is_followable_redirect(status) {
                return Ok((url, response));
            }

            if *redirects == self.policy.max_redirects {
                return Err(FetchError::TooManyRedirects {
                    limit: self.policy.max_redirects,
                });
            }

            url = self.checked(redirect_target(&url, &response)?)?;
            *redirects += 1;
        }
    }

    async fn fetch(&self, raw_url: &str, headers: HeaderMap) -> Result<SafeResponse, FetchError> {
        let deadline = Instant::now() + self.policy.total_timeout;

        let first_url = Url::parse(raw_url).map_err(FetchError::InvalidUrl)?;
        let url = self.checked(first_url)?;
        record_target(&url);

        let mut redirects: u8 = 0;
        let followed = self
            .follow_redirects(url, &headers, deadline, &mut redirects)
            .await;
        tracing::Span::current().record("safe_fetch.redirects", redirects);
        let (url, response) = followed?;

        let status = response.status();
        tracing::Span::current().record("http.response.status_code", status.as_u16());
        if !status.is_success() {
            return Err(FetchError::Status { status });
        }

        // A response without a Content-Type is octet-stream (RFC 9110 §8.3);
        // it is accepted only where the policy accepts octet-stream.
        let media_type = match response.headers().get(CONTENT_TYPE) {
            None => Some(MediaType::octet_stream()),
            Some(value) => value.to_str().ok().and_then(MediaType::from_content_type),
        };
        let media_type = match media_type {
            Some(media_type) if self.policy.media_types.accepts(&media_type) => media_type,
            media_type => return Err(FetchError::MediaTypeNotAllowed { media_type }),
        };

        if response
            .content_length()
            .is_some_and(|length| length > self.policy.max_body_bytes)
        {
            return Err(FetchError::BodyTooLarge {
                limit: self.policy.max_body_bytes,
            });
        }

        Ok(SafeResponse {
            status,
            headers: response.headers().clone(),
            final_url: url,
            media_type,
            body: SafeBody::new(response, &self.policy, deadline),
        })
    }

    /// Check everything about `url` that does not need the network. Host
    /// names are checked later, by the resolver, on the addresses actually
    /// connected to; IP literals skip resolution, so they are checked here.
    fn checked(&self, mut url: Url) -> Result<Url, FetchError> {
        let Some(scheme) = Scheme::of(&url) else {
            return Err(FetchError::SchemeNotAllowed {
                scheme: url.scheme().to_owned(),
            });
        };
        if !self.policy.schemes.allows(scheme) {
            return Err(FetchError::SchemeNotAllowed {
                scheme: url.scheme().to_owned(),
            });
        }

        if !url.username().is_empty() || url.password().is_some() {
            return Err(FetchError::CredentialsInUrl);
        }

        let address = match url.host() {
            None => return Err(FetchError::MissingHost),
            Some(Host::Domain(_)) => None,
            Some(Host::Ipv4(address)) => Some(address.into()),
            Some(Host::Ipv6(address)) => Some(address.into()),
        };
        if let Some(address) = address
            && !self.policy.addresses.allows(address)
        {
            return Err(FetchError::AddressNotAllowed { address });
        }

        let port = url.port().unwrap_or(scheme.default_port());
        if !self.policy.ports.allows(scheme, port) {
            return Err(FetchError::PortNotAllowed { port });
        }

        url.set_fragment(None);
        Ok(url)
    }

    async fn send(
        &self,
        url: &Url,
        headers: HeaderMap,
        deadline: Instant,
    ) -> Result<reqwest::Response, FetchError> {
        let hop = tracing::info_span!(
            "safe_fetch.hop",
            server.address = url.host_str(),
            server.port = url.port_or_known_default(),
            http.response.status_code = tracing::field::Empty,
        );

        let request = self.client.get(url.clone()).headers(headers).send();
        let response = tokio::time::timeout_at(deadline, request)
            .instrument(hop.clone())
            .await
            .map_err(|_elapsed| FetchError::TotalTimeout)?
            .map_err(FetchError::from_reqwest)?;

        hop.record("http.response.status_code", response.status().as_u16());
        Ok(response)
    }
}

/// Statuses whose `Location` names where the resource is. 300, 304 and 305 do
/// not, so they are answered as plain statuses.
fn is_followable_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn redirect_target(current: &Url, response: &reqwest::Response) -> Result<Url, FetchError> {
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(FetchError::InvalidRedirect)?;

    current
        .join(location)
        .map_err(|_parse_error| FetchError::InvalidRedirect)
}

/// Record where the fetch goes without its path, query, or userinfo, which
/// can carry tokens.
fn record_target(url: &Url) {
    let span = tracing::Span::current();
    span.record("url.scheme", url.scheme());
    if let Some(host) = url.host_str() {
        span.record("server.address", host);
    }
    if let Some(port) = url.port_or_known_default() {
        span.record("server.port", port);
    }
}

#[cfg(test)]
mod test;
