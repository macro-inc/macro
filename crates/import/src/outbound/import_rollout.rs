//! Each source's import rollout read from the user's feature flags: an
//! import still being rolled out ([`ImportSource::rollout_flag`]) waits on
//! its flag; every other import is on. Hosts without a flag client use
//! [`crate::domain::ports::ImportsOff`].

#[cfg(test)]
mod test;

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::ImportSource;
use crate::domain::ports::ImportRollout;

/// The rollout read from the user's feature flags. A failed load leaves every
/// flagged import off.
pub struct FlaggedImports<F>(pub F);

#[async_trait::async_trait]
impl<F: FeatureFlags + 'static> ImportRollout for FlaggedImports<F> {
    #[tracing::instrument(name = "import.rollout", skip_all, fields(source = source.as_ref()))]
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>, source: ImportSource) -> bool {
        let Some(flag) = source.rollout_flag() else {
            return true;
        };
        match self.0.load(user).await {
            Ok(flags) => flags.is_enabled(flag),
            Err(error) => {
                tracing::warn!(error = ?error, "could not load an import rollout flag; it stays off");
                false
            }
        }
    }
}
