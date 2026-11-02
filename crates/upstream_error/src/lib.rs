#![deny(missing_docs)]
//! Failures of third-party services, classified once and answered once.
//!
//! An outbound adapter that calls a provider (GitHub, FusionAuth, ...) turns
//! the provider's outage, throttling, or unusable answer into an
//! [`UpstreamError`] instead of a generic internal error. With the `axum`
//! feature, inbound adapters answer it with its `IntoResponse`: 503 when
//! retrying later can help, 502 when the provider answered with something we
//! could not use. Never 500, which says the bug is ours.
//!
//! Connection state (not linked, grant revoked, token expired) is not an
//! upstream failure. The user can fix it, so each domain models it as its own
//! error and answers with a 4xx that says what to do.

use std::time::Duration;

#[cfg(feature = "axum")]
mod response;
#[cfg(feature = "axum")]
pub use response::{UpstreamErrorCode, UpstreamErrorResponse};

#[cfg(all(test, feature = "axum", feature = "reqwest"))]
mod test;

/// Why a call to a third-party service failed, when the failure is the
/// provider's rather than the caller's or ours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum UpstreamFailure {
    /// The provider could not be reached, timed out, or answered with a 5xx.
    #[error("is unavailable")]
    Unavailable,
    /// The provider is throttling our requests.
    #[error("is rate limiting requests")]
    RateLimited {
        /// How long the provider asked us to wait, when it said.
        retry_after: Option<Duration>,
    },
    /// The provider answered with something we could not interpret.
    #[error("returned an unexpected response")]
    InvalidResponse,
}

impl UpstreamFailure {
    /// The failure a provider's HTTP status means. `None` when the status is
    /// not the provider's failure: success, and every 4xx except 429, which
    /// the caller has to interpret for its own endpoint.
    pub fn from_status(status: http::StatusCode, headers: &http::HeaderMap) -> Option<Self> {
        if status == http::StatusCode::TOO_MANY_REQUESTS {
            return Some(Self::RateLimited {
                retry_after: retry_after(headers),
            });
        }
        status.is_server_error().then_some(Self::Unavailable)
    }

    /// The failure a request that got no usable answer means: a body that
    /// could not be decoded is [`Self::InvalidResponse`]; a connection,
    /// timeout, or interrupted body is [`Self::Unavailable`].
    #[cfg(feature = "reqwest")]
    pub fn from_transport(error: &reqwest::Error) -> Self {
        if error.is_decode() {
            Self::InvalidResponse
        } else {
            Self::Unavailable
        }
    }
}

/// The `Retry-After` header in its delay-seconds form. The HTTP-date form is
/// ignored: the providers we call send seconds.
pub fn retry_after(headers: &http::HeaderMap) -> Option<Duration> {
    let seconds = headers
        .get(http::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(seconds))
}

/// A third-party failure, with the provider named the way users know it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{service} {failure}")]
pub struct UpstreamError {
    /// The provider's user-facing name, e.g. `"GitHub"`. It starts the
    /// message clients show, so name what the user recognises.
    pub service: &'static str,
    /// What went wrong.
    pub failure: UpstreamFailure,
}
