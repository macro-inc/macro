//! Where the time tracking rollout is decided.

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::TimeTrackingRollout;

/// Per-user rollout key, shared with the web registry. A missing flag is off.
pub const TIME_TRACKING_FLAG: &str = "enable-time-tracking";

/// The rollout read from the caller's feature flags; failing to load them is off.
pub struct FlaggedTimeTracking<F>(pub F);

#[async_trait::async_trait]
impl<F: FeatureFlags> TimeTrackingRollout for FlaggedTimeTracking<F> {
    #[tracing::instrument(name = "time.rollout", skip_all)]
    async fn enabled_for(&self, user_id: &MacroUserIdStr<'_>) -> bool {
        match self.0.load(user_id).await {
            Ok(flags) => flags.is_enabled(TIME_TRACKING_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the time tracking flag; writes stay off");
                false
            }
        }
    }
}

/// A local stack has time tracking on for everyone; the composition root
/// chooses it only for the local environment.
pub struct LocalTimeTracking;

#[async_trait::async_trait]
impl TimeTrackingRollout for LocalTimeTracking {
    async fn enabled_for(&self, _user_id: &MacroUserIdStr<'_>) -> bool {
        true
    }
}
