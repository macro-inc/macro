use crate::domain::email_privacy::ThreadExclusionGate;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// Shared with the web registry; missing flags remain off in every environment.
pub const ENABLE_CRM_THREAD_EXCLUSIONS: &str = "enable-crm-thread-exclusions";

/// Loads the authenticated caller's rollout snapshot without granting ownership.
pub struct FlaggedThreadExclusions<F>(pub F);

impl<F> std::fmt::Debug for FlaggedThreadExclusions<F> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FlaggedThreadExclusions")
            .finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl<F: FeatureFlags + Send + Sync> ThreadExclusionGate for FlaggedThreadExclusions<F> {
    #[tracing::instrument(name = "crm.thread_exclusions.availability", skip_all)]
    async fn enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        match self.0.load(&caller).await {
            Ok(flags) => flags.is_enabled(ENABLE_CRM_THREAD_EXCLUSIONS),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load CRM thread-exclusion flag");
                false
            }
        }
    }
}

#[cfg(test)]
mod test;
