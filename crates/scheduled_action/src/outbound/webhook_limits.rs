//! Webhook request counts in the shared rate limiter, so every replica
//! counts the same address and hook together.

use std::time::Duration;

use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};
use rootcause::Report;

use crate::domain::webhook::{Limit, LimitScope, WebhookLimits};

/// Keys are hashed, so neither an address nor a hook id is stored as given.
const KEY_PREFIX: &str = "routine-webhook";

pub struct SharedWebhookLimits<S> {
    limiter: S,
}

impl<S> SharedWebhookLimits<S> {
    /// Construct at the composition root with the shared limiter.
    pub fn new(limiter: S) -> Self {
        Self { limiter }
    }
}

fn key(scope: LimitScope) -> RateLimitKey {
    let builder = RateLimitKey::builder(&KEY_PREFIX);
    match scope {
        LimitScope::Address(address) => builder.append(&"address").append(&address),
        LimitScope::NoAddress => builder.append(&"no-address"),
        LimitScope::Hook(hook_id) => builder.append(&"hook").append(&hook_id.as_uuid()),
    }
    .finish()
}

impl<S: RateLimitService> WebhookLimits for SharedWebhookLimits<S> {
    async fn count(&self, scope: LimitScope, limit: Limit) -> Result<Option<Duration>, Report> {
        let counted = self
            .limiter
            .check_rate_limit(key(scope), RateLimitConfig::new(limit.max, limit.window))
            .await?;
        Ok(counted.err().map(|exceeded| exceeded.retry_after))
    }
}
