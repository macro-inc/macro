//! Per-user rollout of history backfill through the backend feature flags.
use crate::domain::ports::{BackfillRollout, Result};
use async_trait::async_trait;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// PostHog flag that opts a user into history backfill.
pub const BACKFILL_FLAG: &str = "enable-granola-backfill";

/// Backfill runs only for users the flag enables. Without a flag client
/// (no PostHog key) it runs for no one; a missing flag reads off.
pub struct FlaggedBackfill<Flags>(pub Option<Flags>);

#[async_trait]
impl<Flags: FeatureFlags> BackfillRollout for FlaggedBackfill<Flags> {
    async fn enabled(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        let Some(flags) = &self.0 else {
            return Ok(false);
        };
        Ok(flags.load(user).await?.is_enabled(BACKFILL_FLAG))
    }
}

#[cfg(test)]
mod test;
