//! [`StreamLimiter`] over `rate_limit` concurrency leases (Redis).

use crate::domain::ports::{LimitKey, StreamLimiter};
use crate::domain::stream::REVALIDATE_INTERVAL;
use rate_limit::{ConcurrencyLease, ConcurrencyLimitConfig, ConcurrencyLimitPort, RateLimitKey};
use rootcause::Report;

/// Leases live three renewal intervals, so one slow renewal does not drop a
/// live stream, and a crashed process' streams stop counting within minutes.
const LEASE_RENEWALS: u32 = 3;

/// Concurrent-stream leases.
pub struct LeaseStreamLimiter<C> {
    leases: C,
}

impl<C> LeaseStreamLimiter<C> {
    /// Lease through `leases`.
    pub fn new(leases: C) -> Self {
        Self { leases }
    }
}

fn rate_limit_key(key: &LimitKey) -> RateLimitKey {
    match key {
        LimitKey::User(user) => RateLimitKey::builder(&"event-streams:user").append(user),
        LimitKey::ApiKey(digest) => RateLimitKey::builder(&"event-streams:api-key").append(digest),
        LimitKey::Bot(bot_id) => RateLimitKey::builder(&"event-streams:bot").append(bot_id),
    }
    .finish()
}

fn config(key: &LimitKey) -> ConcurrencyLimitConfig {
    ConcurrencyLimitConfig {
        max_holders: key.max_streams(),
        lease: REVALIDATE_INTERVAL * LEASE_RENEWALS,
    }
}

impl<C: ConcurrencyLimitPort> StreamLimiter for LeaseStreamLimiter<C> {
    async fn acquire(&self, keys: &[LimitKey], stream: &str) -> Result<Option<LimitKey>, Report> {
        for (index, key) in keys.iter().enumerate() {
            let lease = self
                .leases
                .acquire(&rate_limit_key(key), stream, config(key))
                .await?;
            if let ConcurrencyLease::Exceeded { .. } = lease {
                self.release(&keys[..index], stream).await;
                return Ok(Some(key.clone()));
            }
        }
        Ok(None)
    }

    async fn release(&self, keys: &[LimitKey], stream: &str) {
        for key in keys {
            if let Err(error) = self.leases.release(&rate_limit_key(key), stream).await {
                tracing::warn!(error = ?error, limit = key.kind(), "failed to release an event stream lease; it lapses on its own");
            }
        }
    }
}
