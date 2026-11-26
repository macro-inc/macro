use crate::domain::{
    email_policy_api::SelectiveEmailGate, email_rules::SELECTIVE_EMAIL_CONTRIBUTION_FLAG,
};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// Caller-scoped remote rollout. Missing or failed flags keep authoring off.
pub struct FlaggedSelectiveEmail<F>(pub F);
impl<F> std::fmt::Debug for FlaggedSelectiveEmail<F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FlaggedSelectiveEmail")
            .finish_non_exhaustive()
    }
}
#[async_trait::async_trait]
impl<F: FeatureFlags + Send + Sync> SelectiveEmailGate for FlaggedSelectiveEmail<F> {
    #[tracing::instrument(name = "crm.email_policy.availability", skip_all)]
    async fn enabled_for(&self, user: MacroUserIdStr<'_>) -> bool {
        match self.0.load(&user).await {
            Ok(flags) => flags.is_enabled(SELECTIVE_EMAIL_CONTRIBUTION_FLAG),
            Err(error) => {
                tracing::warn!(error=?error,"failed to load selective email contribution flag");
                false
            }
        }
    }
}
