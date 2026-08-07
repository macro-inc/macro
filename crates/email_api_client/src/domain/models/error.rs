use std::time::Duration;

use thiserror::Error;

/// A rate-limit decision made before a provider request is attempted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RateLimitRefusal {
    /// Delay suggested before retrying, when one is known.
    pub retry_after: Option<Duration>,
}

impl RateLimitRefusal {
    /// Creates a rate-limit refusal with an optional retry delay.
    pub fn new(retry_after: Option<Duration>) -> Self {
        Self { retry_after }
    }
}

/// A provider-neutral failure from an email API capability.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum EmailApiError {
    /// The request was refused by local quota policy or the provider.
    #[error("email provider rate limit exceeded")]
    RateLimited {
        /// Delay suggested before retrying, when one is known.
        retry_after: Option<Duration>,
        /// Whether the refusal came from local policy or the provider itself.
        origin: RateLimitOrigin,
    },
    /// The provider grant must be reauthorized.
    #[error("email provider authorization is required")]
    AuthRequired,
    /// The provider refused the operation despite valid authentication.
    #[error("email provider operation is forbidden")]
    Forbidden,
    /// The requested provider resource does not exist.
    #[error("email provider resource was not found")]
    NotFound,
    /// The operation conflicts with existing provider state.
    #[error("email provider state conflict")]
    Conflict,
    /// The incremental synchronization cursor is too old to use.
    #[error("email synchronization cursor is outdated")]
    OutdatedCursor,
    /// A transport or provider failure that may succeed when retried.
    #[error("transient email provider failure: {message}")]
    Transient {
        /// A sanitized diagnostic suitable for logs.
        message: String,
    },
    /// A deterministic failure that should not be retried unchanged.
    #[error("permanent email provider failure: {message}")]
    Permanent {
        /// A sanitized diagnostic suitable for logs.
        message: String,
    },
}

impl EmailApiError {
    /// Returns whether retrying the same operation may succeed.
    pub fn is_transient(&self) -> bool {
        matches!(self, Self::RateLimited { .. } | Self::Transient { .. })
    }
}

/// Where a rate-limit refusal originated.
///
/// Callers use this to distinguish a local budget refusal (no provider quota
/// was consumed; a drop-and-wait policy may be appropriate) from the provider
/// itself throttling the request (retrying preserves delivery guarantees).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RateLimitOrigin {
    /// Refused by local quota policy before any provider call was made.
    Local,
    /// The provider itself throttled the request.
    Provider,
}

impl From<RateLimitRefusal> for EmailApiError {
    fn from(refusal: RateLimitRefusal) -> Self {
        Self::RateLimited {
            retry_after: refusal.retry_after,
            origin: RateLimitOrigin::Local,
        }
    }
}

#[cfg(test)]
mod test;
