//! The search allowance an account's user API keys share: up to 200 searches
//! at once, then one a second. It is a safety net against a program that
//! searches in a loop, so it is counted in a bucket every process shares, and
//! a bucket that cannot be read lets the search run.

#[cfg(test)]
mod test;

use std::time::Duration;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rate_limit::{RateLimitKey, TokenBucketConfig, TokenBucketPort, TokenBucketResult};
use rootcause::Report;

/// The bucket all of one account's user API keys draw their searches from.
pub(crate) const API_KEY_SEARCH_BUCKET: TokenBucketConfig = TokenBucketConfig {
    capacity: 200,
    refill_interval: Duration::from_secs(1),
};

/// How long a search waits on the bucket before it runs without it.
const BUCKET_TIMEOUT: Duration = Duration::from_millis(500);

/// Token buckets shared by every search process.
// Object-safe so `SearchHandlerState` can hold it without a type parameter.
#[async_trait::async_trait]
pub trait SearchTokenBuckets: Send + Sync + 'static {
    /// Take one token from the bucket at `key`.
    async fn take(
        &self,
        key: RateLimitKey,
        config: TokenBucketConfig,
    ) -> Result<TokenBucketResult, Report>;
}

#[async_trait::async_trait]
impl<T: TokenBucketPort> SearchTokenBuckets for T {
    async fn take(
        &self,
        key: RateLimitKey,
        config: TokenBucketConfig,
    ) -> Result<TokenBucketResult, Report> {
        TokenBucketPort::take(self, key, config).await
    }
}

/// What one API-key search drew from its account's allowance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AllowanceDraw {
    /// The search runs, with `remaining` more allowed before the account is
    /// limited.
    Allowed { remaining: u64 },
    /// The account used its allowance; its next search is allowed after
    /// `retry_after`.
    Limited { retry_after: Duration },
    /// The bucket could not be read in time, so the search runs unlimited.
    Unavailable,
}

impl AllowanceDraw {
    /// The outcome as a span value.
    pub(crate) fn label(self) -> &'static str {
        match self {
            AllowanceDraw::Allowed { .. } => "allowed",
            AllowanceDraw::Limited { .. } => "limited",
            AllowanceDraw::Unavailable => "unavailable",
        }
    }

    /// Searches the account may still send at once, when the bucket was read.
    pub(crate) fn remaining(self) -> Option<u64> {
        match self {
            AllowanceDraw::Allowed { remaining } => Some(remaining),
            AllowanceDraw::Limited { .. } => Some(0),
            AllowanceDraw::Unavailable => None,
        }
    }
}

/// Draw one search from the allowance of `account`'s user API keys.
pub(crate) async fn draw_api_key_search(
    buckets: &dyn SearchTokenBuckets,
    account: &MacroUserId<Lowercase<'_>>,
) -> AllowanceDraw {
    let key = RateLimitKey::builder(&"api-key-search")
        .append(&account.as_ref())
        .finish();
    let taken =
        tokio::time::timeout(BUCKET_TIMEOUT, buckets.take(key, API_KEY_SEARCH_BUCKET)).await;

    match taken {
        Ok(Ok(TokenBucketResult::Taken { remaining })) => AllowanceDraw::Allowed { remaining },
        Ok(Ok(TokenBucketResult::Empty { retry_after })) => AllowanceDraw::Limited { retry_after },
        Ok(Err(error)) => {
            tracing::warn!(error = ?error, "search allowance unreadable; searching without it");
            AllowanceDraw::Unavailable
        }
        Err(_) => {
            tracing::warn!(
                timeout_ms = BUCKET_TIMEOUT.as_millis(),
                "search allowance timed out; searching without it"
            );
            AllowanceDraw::Unavailable
        }
    }
}
