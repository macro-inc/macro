//! The one way the outbound adapters call GitHub's REST and GraphQL APIs.
//!
//! GitHub limits each token: 5,000 requests an hour (the primary limit,
//! shared by every app the user authorized) and short-term secondary limits
//! on bursts. Every request here is paced per token, holds briefly when
//! GitHub says it will work again within [`MAX_HOLD`], retries once, and only
//! then fails as [`UpstreamFailure::RateLimited`] with when to retry.
//! Identical reads in flight together share one request, and GETs revalidate
//! with their `ETag`: a 304 costs no quota.
//! See https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api

use std::{
    collections::HashMap,
    num::{NonZeroU32, NonZeroUsize},
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use reqwest::{
    Method, StatusCode,
    header::{ETAG, HeaderMap, HeaderValue, IF_NONE_MATCH, RETRY_AFTER},
};
use sha2::{Digest, Sha256};
use tokio::{sync::OnceCell, time::Instant};
use upstream_error::{UpstreamError, UpstreamFailure};

use crate::domain::models::GithubError;

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
/// GitHub's name in error messages users see.
const GITHUB: &str = "GitHub";
const USER_AGENT: &str = "Macro-Auth-Service";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The longest a request waits for its turn or for GitHub to accept requests
/// again. Past it, the caller gets the rate limit error at once.
const MAX_HOLD: Duration = Duration::from_secs(1);
/// How long GitHub asks to wait after a secondary limit that names no time.
const UNNAMED_SECONDARY_LIMIT_WAIT: Duration = Duration::from_secs(60);
/// Responses kept for `ETag` revalidation, across all tokens.
const ETAG_CACHE_ENTRIES: NonZeroUsize = NonZeroUsize::new(1024).expect("non-zero");
/// GitHub's secondary limit allows 900 REST points a minute per token.
const PACED_REQUESTS_PER_MINUTE: NonZeroU32 = NonZeroU32::new(900).expect("non-zero");
/// ... and at most 100 concurrent requests.
const PACED_BURST: NonZeroU32 = NonZeroU32::new(100).expect("non-zero");
/// Tokens tracked before idle ones are forgotten.
const TRACKED_TOKENS: usize = 10_000;

/// A token, hashed so the shared maps never hold credentials.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct TokenKey([u8; 32]);

impl TokenKey {
    fn of(access_token: &str) -> Self {
        Self(Sha256::digest(access_token.as_bytes()).into())
    }
}

/// Whether a request only reads, so identical concurrent ones may share an
/// answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GithubAccess {
    Read,
    Write,
}

/// A request to GitHub's API.
pub(crate) struct GithubRequest<'a> {
    method: Method,
    /// The path after the API base URL, with its query.
    path: String,
    access_token: &'a str,
    body: Option<serde_json::Value>,
    access: GithubAccess,
}

impl<'a> GithubRequest<'a> {
    pub(crate) fn get(access_token: &'a str, path: String) -> Self {
        Self {
            method: Method::GET,
            path,
            access_token,
            body: None,
            access: GithubAccess::Read,
        }
    }

    /// A request with a JSON body. GraphQL queries are reads sent as POST.
    #[cfg(feature = "link")]
    pub(crate) fn with_body(
        method: Method,
        access_token: &'a str,
        path: String,
        body: serde_json::Value,
        access: GithubAccess,
    ) -> Self {
        Self {
            method,
            path,
            access_token,
            body: Some(body),
            access,
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

type SharedRead = Arc<OnceCell<Result<GithubResponse, UpstreamFailure>>>;

struct CachedResponse {
    etag: HeaderValue,
    response: GithubResponse,
}

struct GithubHttpState {
    pacing: DefaultKeyedRateLimiter<TokenKey>,
    /// Tokens GitHub has throttled, and when it accepts requests again.
    throttled_until: Mutex<HashMap<TokenKey, Instant>>,
    reads_in_flight: Mutex<HashMap<ReadKey, SharedRead>>,
    etag_cache: Mutex<lru::LruCache<(TokenKey, String), CachedResponse>>,
}

/// Calls GitHub's API, paced and coalesced per token. Clones share state, so
/// build one per process and clone it.
#[derive(Clone)]
pub(crate) struct GithubHttp {
    client: reqwest::Client,
    api_base_url: String,
    state: Arc<GithubHttpState>,
}

impl GithubHttp {
    pub(crate) fn new(client: reqwest::Client) -> Self {
        Self::with_api_base_url(client, GITHUB_API_BASE_URL.to_string())
    }

    pub(crate) fn with_api_base_url(client: reqwest::Client, api_base_url: String) -> Self {
        let quota = Quota::per_minute(PACED_REQUESTS_PER_MINUTE).allow_burst(PACED_BURST);
        Self {
            client,
            api_base_url,
            state: Arc::new(GithubHttpState {
                pacing: RateLimiter::keyed(quota),
                throttled_until: Mutex::new(HashMap::new()),
                reads_in_flight: Mutex::new(HashMap::new()),
                etag_cache: Mutex::new(lru::LruCache::new(ETAG_CACHE_ENTRIES)),
            }),
        }
    }

    /// Sends the request. Errors are only GitHub failing or throttling;
    /// every other status is the caller's to interpret.
    pub(crate) async fn send(
        &self,
        request: GithubRequest<'_>,
    ) -> Result<GithubResponse, GithubError> {
        let token = TokenKey::of(request.access_token);
        if request.access == GithubAccess::Write {
            return self.send_paced(token, &request).await.map_err(upstream);
        }

        let key = ReadKey {
            token,
            method: request.method.clone(),
            path: request.path.clone(),
            body: request.body.as_ref().map(serde_json::Value::to_string),
        };
        let shared = self
            .state
            .reads_in_flight
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.clone())
            .or_default()
            .clone();
        // A caller dropped mid-request leaves the cell empty, and the next
        // waiter sends it instead.
        let result = shared
            .get_or_init(|| self.send_paced(token, &request))
            .await
            .clone();
        let mut reads_in_flight = self
            .state
            .reads_in_flight
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if reads_in_flight
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &shared))
        {
            reads_in_flight.remove(&key);
        }
        result.map_err(upstream)
    }

    /// Waits for the token's turn, sends, and retries once when GitHub
    /// throttles with a wait inside [`MAX_HOLD`].
    #[tracing::instrument(
        name = "github.request",
        skip_all,
        err,
        fields(
            method = %request.method,
            path = %request.path,
            status = tracing::field::Empty,
            etag_hit = false,
            throttled_retry = false,
        )
    )]
    async fn send_paced(
        &self,
        token: TokenKey,
        request: &GithubRequest<'_>,
    ) -> Result<GithubResponse, UpstreamFailure> {
        self.wait_turn(token).await?;
        let retry_after = match self.send_once(token, request).await? {
            Sent::Answered(response) => return Ok(response),
            Sent::Throttled(Throttled { retry_after }) => retry_after,
        };
        let Some(wait) = retry_after.filter(|wait| *wait <= MAX_HOLD) else {
            return Err(UpstreamFailure::RateLimited { retry_after });
        };

        tracing::Span::current().record("throttled_retry", true);
        tokio::time::sleep(wait).await;
        match self.send_once(token, request).await? {
            Sent::Answered(response) => Ok(response),
            Sent::Throttled(Throttled { retry_after }) => {
                Err(UpstreamFailure::RateLimited { retry_after })
            }
        }
    }

    /// Holds the request until GitHub accepts the token's requests again and
    /// the pacing quota has room, or fails when that is past [`MAX_HOLD`].
    async fn wait_turn(&self, token: TokenKey) -> Result<(), UpstreamFailure> {
        let throttled_for = self
            .state
            .throttled_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&token)
            .map(|until| until.saturating_duration_since(Instant::now()))
            .filter(|wait| !wait.is_zero());
        if let Some(wait) = throttled_for {
            if wait > MAX_HOLD {
                return Err(UpstreamFailure::RateLimited {
                    retry_after: Some(wait),
                });
            }
            tokio::time::sleep(wait).await;
        }

        if self.state.pacing.len() > TRACKED_TOKENS {
            self.state.pacing.retain_recent();
        }
        tokio::time::timeout(MAX_HOLD, self.state.pacing.until_key_ready(&token))
            .await
            .map_err(|_| UpstreamFailure::RateLimited {
                retry_after: Some(MAX_HOLD),
            })
    }

    async fn send_once(
        &self,
        token: TokenKey,
        request: &GithubRequest<'_>,
    ) -> Result<Sent, UpstreamFailure> {
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

        let throttled = throttling(status, &headers, &body);
        self.remember_quota(token, throttled, &headers);
        if let Some(throttled) = throttled {
            tracing::warn!(status=%status, path=%request.path, "github is throttling");
            return Ok(Sent::Throttled(throttled));
        }

        if status == StatusCode::NOT_MODIFIED
            && let Some((_, response)) = cached
        {
            tracing::Span::current().record("etag_hit", true);
            return Ok(Sent::Answered(response));
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
        Ok(Sent::Answered(response))
    }

    /// Records when GitHub accepts the token's requests again: after the wait
    /// a throttled answer asks for, or at `x-ratelimit-reset` once the
    /// primary quota is spent.
    fn remember_quota(&self, token: TokenKey, throttled: Option<Throttled>, headers: &HeaderMap) {
        let wait = match throttled {
            Some(Throttled { retry_after }) => {
                Some(retry_after.unwrap_or(UNNAMED_SECONDARY_LIMIT_WAIT))
            }
            None if quota_exhausted(headers) => rate_limit_reset(headers),
            None => None,
        };
        let Some(wait) = wait else {
            return;
        };
        let now = Instant::now();
        let mut throttled_until = self
            .state
            .throttled_until
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        throttled_until.retain(|_, until| *until > now);
        throttled_until.insert(token, now + wait);
    }
}

/// GitHub refused the request for its rate limit.
#[derive(Clone, Copy)]
struct Throttled {
    /// How long GitHub asked to wait, when it said.
    retry_after: Option<Duration>,
}

enum Sent {
    Answered(GithubResponse),
    Throttled(Throttled),
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

/// GitHub throttling. A 429, or a 403 that carries `Retry-After`, exhausts
/// `x-ratelimit-remaining` (primary limit), or says it hit a secondary rate
/// limit, which GitHub may send without either header; any other 403 is a
/// real refusal.
/// See https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
fn throttling(status: StatusCode, headers: &HeaderMap, body: &[u8]) -> Option<Throttled> {
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
    throttled.then(|| Throttled {
        retry_after: upstream_error::retry_after(headers)
            .or_else(|| quota_exhausted.then(|| rate_limit_reset(headers)).flatten()),
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
