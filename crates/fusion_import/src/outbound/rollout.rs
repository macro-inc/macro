//! Where the Fusion import rollout is decided.

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::FusionRollout;

/// Per-user rollout key, shared with the web registry. A missing flag is off.
pub const FUSION_IMPORT_FLAG: &str = "enable-fusion-import";

/// The rollout read from the caller's feature flags; failing to load them is
/// off.
pub struct FlaggedFusionImport<F>(pub F);

impl<F: FeatureFlags + 'static> FusionRollout for FlaggedFusionImport<F> {
    #[tracing::instrument(name = "fusion.rollout", skip_all)]
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> bool {
        match self.0.load(user).await {
            Ok(flags) => flags.is_enabled(FUSION_IMPORT_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the Fusion import flag; the import stays off");
                false
            }
        }
    }
}
