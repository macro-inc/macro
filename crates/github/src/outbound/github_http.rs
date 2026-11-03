//! The one way the outbound adapters call GitHub's REST and GraphQL APIs.
//!
//! GitHub limits each token: 5,000 requests an hour (the primary limit,
//! shared by every app the user authorized) and short-term secondary limits
//! on bursts. Requests are paced per token by [`outbound_pacing`]; this
//! module reads GitHub's rate limit headers into its answers, shares
//! identical in-flight reads, and revalidates GETs with their `ETag`: a 304
//! costs no quota.
//! See https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

use std::{
    num::{NonZeroU32, NonZeroUsize},
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use outbound_pacing::{Answer, PaceError, Pacer, PacingConfig, SingleFlight, Throttled};
use reqwest::{
    Method, StatusCode,
    header::{ETAG, HeaderMap, HeaderValue, IF_NONE_MATCH, RETRY_AFTER},
};
use sha2::{Digest, Sha256};
use upstream_error::{UpstreamError, UpstreamFailure};

use crate::domain::models::GithubError;

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
/// GitHub's name in error messages users see.
const GITHUB: &str = "GitHub";
const USER_AGENT: &str = "Macro-Auth-Service";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Responses kept for `ETag` revalidation, across all tokens.
const ETAG_CACHE_ENTRIES: NonZeroUsize = NonZeroUsize::new(1024).expect("non-zero");
const PACING: PacingConfig = PacingConfig {
    // GitHub's secondary limit: 900 REST points a minute and 100 concurrent
    // requests per token.
    per_minute: NonZeroU32::new(900).expect("non-zero"),
    burst: NonZeroU32::new(100).expect("non-zero"),
    max_hold: Duration::from_secs(1),
    // GitHub asks for at least a minute after a secondary limit that names
    // no time.
    unnamed_wait: Duration::from_secs(60),
};

/// A token, hashed so the shared maps never hold credentials.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct TokenKey([u8; 32]);

impl TokenKey {
    fn of(access_token: &str) -> Self {
        Self(Sha256::digest(access_token.as_bytes()).into())
    }
}

/// A request to GitHub's API.
pub(crate) struct GithubRequest {
    method: Method,
    /// The path after the API base URL, with its query.
    path: String,
    access_token: String,
    body: Option<serde_json::Value>,
    /// Only reads: identical ones in flight together may share one answer.
    shareable: bool,
}

impl GithubRequest {
    pub(crate) fn get(access_token: &str, path: String) -> Self {
        Self {
            method: Method::GET,
            path,
            access_token: access_token.to_owned(),
            body: None,
            shareable: true,
        }
    }

    /// A GraphQL operation. Queries are reads; mutations change GitHub.
    #[cfg(feature = "link")]
    pub(crate) fn graphql(access_token: &str, query: &str, variables: serde_json::Value) -> Self {
        Self {
            method: Method::POST,
            path: "/graphql".to_string(),
            access_token: access_token.to_owned(),
            body: Some(serde_json::json!({ "query": query, "variables": variables })),
            shareable: !query.trim_start().starts_with("mutation"),
        }
    }

    /// A REST request that changes GitHub.
    #[cfg(feature = "link")]
    pub(crate) fn change(
        method: Method,
        access_token: &str,
        path: String,
        body: serde_json::Value,
    ) -> Self {
        Self {
            method,
            path,
            access_token: access_token.to_owned(),
            body: Some(body),
            shareable: false,
        }
    }
}

/// GitHub's answer, read in full so shared and cached answers can be cloned.
/// Throttling never comes back as a response; it is an error.
#[derive(Clone, Debug)]
pub(crate) struct GithubResponse {
    pub(crate) status: StatusCode,
    pub(crate) headers: HeaderMap,
    pub(crate) body: Bytes,
}

impl GithubResponse {
    /// Reads a response from outside the API, such as the OAuth code
    /// exchange, which is neither paced nor cached.
    #[cfg(feature = "link")]
    pub(crate) async fn read(response: reqwest::Response) -> Result<Self, GithubError> {
        let status = response.status();
        let headers = response.headers().clone();
        let body = response
            .bytes()
            .await
            .map_err(|error| upstream(transport_failure(error)))?;
        Ok(Self {
            status,
            headers,
            body,
        })
    }

    pub(crate) fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, GithubError> {
        serde_json::from_slice(&self.body).map_err(|error| {
            tracing::error!(error=?error, status=%self.status, "github returned an undecodable body");
            upstream(UpstreamFailure::InvalidResponse)
        })
    }

    pub(crate) fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// A read in flight, identified by everything that shapes its answer.
#[derive(Clone, PartialEq, Eq, Hash)]
struct ReadKey {
    token: TokenKey,
    method: Method,
    path: String,
    body: Option<String>,
}

struct CachedResponse {
    etag: HeaderValue,
    response: GithubResponse,
}

struct GithubHttpState {
    pacer: Pacer<TokenKey>,
    reads: SingleFlight<ReadKey, Result<GithubResponse, UpstreamFailure>>,
    etag_cache: Mutex<lru::LruCache<(TokenKey, String), CachedResponse>>,
}

/// Calls GitHub's API, paced and coalesced per token. Clones share state, so
/// build one per process and clone it.
#[derive(Clone)]
pub(crate) struct GithubHttp {
    client: reqwest::Client,
    api_base_url: Arc<str>,
    state: Arc<GithubHttpState>,
}

impl GithubHttp {
    pub(crate) fn new(client: reqwest::Client) -> Self {
        Self::with_api_base_url(client, GITHUB_API_BASE_URL.to_string())
    }

    pub(crate) fn with_api_base_url(client: reqwest::Client, api_base_url: String) -> Self {
        Self {
            client,
            api_base_url: api_base_url.into(),
            state: Arc::new(GithubHttpState {
                pacer: Pacer::new(PACING),
                reads: SingleFlight::default(),
                etag_cache: Mutex::new(lru::LruCache::new(ETAG_CACHE_ENTRIES)),
            }),
        }
    }

    /// Sends the request. Errors are only GitHub failing or throttling;
    /// every other status is the caller's to interpret.
    pub(crate) async fn send(&self, request: GithubRequest) -> Result<GithubResponse, GithubError> {
        let token = TokenKey::of(&request.access_token);
        if !request.shareable {
            return self.send_paced(token, request).await.map_err(upstream);
        }

        let key = ReadKey {
            token,
            method: request.method.clone(),
            path: request.path.clone(),
            body: request.body.as_ref().map(serde_json::Value::to_string),
        };
        let http = self.clone();
        self.state
            .reads
            .run(key, async move { http.send_paced(token, request).await })
            .await
            .map_err(upstream)
    }

    #[tracing::instrument(
        name = "github.request",
        skip_all,
        err,
        fields(
            method = %request.method,
            path = %request.path,
            status = tracing::field::Empty,
            etag_hit = false,
        )
    )]
    async fn send_paced(
        &self,
        token: TokenKey,
        request: GithubRequest,
    ) -> Result<GithubResponse, UpstreamFailure> {
        self.state
            .pacer
            .call(&token, || self.send_once(token, &request))
            .await
            .map_err(|error| match error {
                PaceError::Throttled(Throttled { retry_after }) => {
                    UpstreamFailure::RateLimited { retry_after }
                }
                PaceError::Failed(failure) => failure,
            })
    }

    async fn send_once(
        &self,
        token: TokenKey,
        request: &GithubRequest,
    ) -> Result<Answer<GithubResponse>, UpstreamFailure> {
        let cache_key = (request.method == Method::GET).then(|| (token, request.path.clone()));
        let cached = cache_key.as_ref().and_then(|key| {
            self.state
                .etag_cache
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(key)
                .map(|cached| (cached.etag.clone(), cached.response.clone()))
        });

        let mut builder = self
            .client
            .request(
                request.method.clone(),
                format!("{}{}", self.api_base_url, request.path),
            )
            .header("Authorization", format!("Bearer {}", request.access_token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(REQUEST_TIMEOUT);
        if let Some((etag, _)) = &cached {
            builder = builder.header(IF_NONE_MATCH, etag);
        }
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }

        let response = builder.send().await.map_err(transport_failure)?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.bytes().await.map_err(transport_failure)?;
        tracing::Span::current().record("status", status.as_u16());

        if let Some(retry_after) = throttled(status, &headers, &body) {
            tracing::warn!(status=%status, path=%request.path, "github is throttling");
            return Ok(Answer::Throttled { retry_after });
        }
        // The primary quota can run out on an accepted request; hold the
        // token back until it refills instead of spending requests on 403s.
        if quota_exhausted(&headers)
            && let Some(reset) = rate_limit_reset(&headers)
        {
            self.state.pacer.block(&token, reset);
        }

        if status == StatusCode::NOT_MODIFIED
            && let Some((_, response)) = cached
        {
            tracing::Span::current().record("etag_hit", true);
            return Ok(Answer::Accepted(response));
        }
        let response = GithubResponse {
            status,
            headers,
            body,
        };
        if let Some(cache_key) = cache_key {
            let mut etag_cache = self
                .state
                .etag_cache
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            match response.headers.get(ETAG) {
                Some(etag) if status == StatusCode::OK => {
                    etag_cache.put(
                        cache_key,
                        CachedResponse {
                            etag: etag.clone(),
                            response: response.clone(),
                        },
                    );
                }
                _ => {
                    etag_cache.pop(&cache_key);
                }
            }
        }
        Ok(Answer::Accepted(response))
    }
}

fn upstream(failure: UpstreamFailure) -> GithubError {
    GithubError::Upstream(UpstreamError {
        service: GITHUB,
        failure,
    })
}

/// A request outside the API that got no usable answer from GitHub.
#[cfg(feature = "link")]
pub(crate) fn transport_error(error: reqwest::Error) -> GithubError {
    upstream(transport_failure(error))
}

/// A request that got no usable answer from GitHub.
fn transport_failure(error: reqwest::Error) -> UpstreamFailure {
    tracing::error!(error=?error, "request to github failed");
    UpstreamFailure::from_transport(&error)
}

fn quota_exhausted(headers: &HeaderMap) -> bool {
    headers
        .get("x-ratelimit-remaining")
        .is_some_and(|remaining| remaining == "0")
}

/// Whether GitHub throttled the request, and how long it asked to wait. A
/// 429, or a 403 that carries `Retry-After`, exhausts
/// `x-ratelimit-remaining` (primary limit), or says it hit a secondary rate
/// limit, which GitHub may send without either header; any other 403 is a
/// real refusal.
/// See https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
fn throttled(status: StatusCode, headers: &HeaderMap, body: &[u8]) -> Option<Option<Duration>> {
    let quota_exhausted = quota_exhausted(headers);
    let throttled = status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && (headers.contains_key(RETRY_AFTER)
                || quota_exhausted
                || String::from_utf8_lossy(body)
                    .to_ascii_lowercase()
                    .contains("secondary rate limit")));
    // `x-ratelimit-reset` is when the primary quota refills, so it only says
    // when to retry once that quota is spent.
    throttled.then(|| {
        upstream_error::retry_after(headers)
            .or_else(|| quota_exhausted.then(|| rate_limit_reset(headers)).flatten())
    })
}

/// How long until `x-ratelimit-reset`, a Unix time in seconds.
fn rate_limit_reset(headers: &HeaderMap) -> Option<Duration> {
    let reset: u64 = headers
        .get("x-ratelimit-reset")?
        .to_str()
        .ok()?
        .parse()
        .ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(reset.saturating_sub(now)))
}

/// A response the call did not expect: GitHub failing is upstream; anything
/// else is ours to look into.
pub(crate) fn unexpected(response: &GithubResponse, context: &str) -> GithubError {
    let body = response.text();
    match UpstreamFailure::from_status(response.status, &response.headers) {
        Some(failure) => {
            tracing::error!(status=%response.status, body=%body, context, "github is failing");
            upstream(failure)
        }
        None => GithubError::Internal(anyhow::anyhow!(
            "{context} (status {}): {body}",
            response.status
        )),
    }
}
