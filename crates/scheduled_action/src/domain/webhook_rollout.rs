//! Who may use routine webhooks, decided per routine owner by a PostHog flag.
//! Off, every webhook route answers as it does for an unknown URL.

use std::future::Future;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

/// PostHog rollout shared with the web app's trigger menu.
pub const ROUTINE_WEBHOOKS_FLAG: &str = "enable-routine-webhooks";

/// Whether a user may make, see and remove webhook URLs, and have their
/// routines' URLs accept deliveries.
pub trait WebhookRollout: Send + Sync + 'static {
    /// A failed flag load is an error; each caller decides its answer.
    fn enabled_for(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// Reads [`ROUTINE_WEBHOOKS_FLAG`] for each user.
#[derive(Debug, Clone)]
pub struct FlaggedWebhooks<F>(F);

impl<F> FlaggedWebhooks<F> {
    pub fn new(flags: F) -> Self {
        Self(flags)
    }
}

impl<F: FeatureFlags + 'static> WebhookRollout for FlaggedWebhooks<F> {
    #[tracing::instrument(
        name = "routine.webhooks_flag",
        err,
        skip_all,
        fields(enabled = tracing::field::Empty)
    )]
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        let enabled = self.0.load(user).await?.is_enabled(ROUTINE_WEBHOOKS_FLAG);
        tracing::Span::current().record("enabled", enabled);
        Ok(enabled)
    }
}

/// A deployment without a flag source keeps webhooks off.
impl<R: WebhookRollout> WebhookRollout for Option<R> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> Result<bool, Report> {
        match self {
            Some(rollout) => rollout.enabled_for(user).await,
            None => Ok(false),
        }
    }
}
