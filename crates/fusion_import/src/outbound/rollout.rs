//! Where the Fusion import rollout is decided.

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::FusionRollout;

/// Per-user rollout key, shared with the web registry. A missing flag is off.
pub const FUSION_IMPORT_FLAG: &str = "enable-fusion-import";

/// Who may import: per the caller's feature flags (a failed flag read is
/// off), everyone (a local stack), or nobody (a host with no flag client).
pub enum FusionImportRollout<F> {
    /// Per the caller's `enable-fusion-import` flag.
    Flagged(F),
    /// On for everyone; the composition root chooses it only locally.
    Everyone,
    /// Off for everyone, as when a flag read fails.
    Nobody,
}

impl<F: FeatureFlags + 'static> FusionRollout for FusionImportRollout<F> {
    #[tracing::instrument(name = "fusion.rollout", skip_all)]
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> bool {
        let flags = match self {
            Self::Flagged(flags) => flags,
            Self::Everyone => return true,
            Self::Nobody => return false,
        };
        match flags.load(user).await {
            Ok(flags) => flags.is_enabled(FUSION_IMPORT_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the Fusion import flag; the import stays off");
                false
            }
        }
    }
}
