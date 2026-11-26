//! The per-user allowance of failed MCP Events callback verifications, kept
//! in the shared rate limiter so every replica counts against one budget.

use crate::domain::mcp::models::{MAX_FAILED_VERIFICATIONS, VERIFICATION_WINDOW};
use crate::domain::mcp::ports::McpVerificationLimiter;
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};

/// [`McpVerificationLimiter`] over a [`RateLimitService`].
#[derive(Clone)]
pub struct RateLimitedMcpVerifications<R>(pub R);

impl<R> McpVerificationLimiter for RateLimitedMcpVerifications<R>
where
    R: RateLimitService + Clone,
{
    type Ticket = RateLimitOk;

    async fn take(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Option<RateLimitOk>, rootcause::Report> {
        let key = RateLimitKey::builder(&"mcp-events-failed-verifications")
            .append(&user_id.as_ref())
            .finish();
        let config = RateLimitConfig {
            max_count: u64::from(MAX_FAILED_VERIFICATIONS),
            window: VERIFICATION_WINDOW,
        };
        Ok(self.0.check_rate_limit(key, config).await?.ok())
    }

    async fn give_back(&self, ticket: RateLimitOk) {
        if let Err(error) = self.0.rollback_ticket(ticket).await {
            // The attempt stays counted; the user loses one of their ten.
            tracing::warn!(error = ?error, "could not return an MCP verification attempt");
        }
    }
}
