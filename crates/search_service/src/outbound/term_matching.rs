//! Feature-flag backed rollout of dynamic multi-term matching.

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::term_matching::TermMatchingRollout;

const ENABLE_DYNAMIC_SEARCH_TERM_MATCHING: &str = "enable-dynamic-search-term-matching";

/// Reads the per-user flag for each search that asks for dynamic matching.
pub struct FlaggedTermMatching<F>(pub F);

#[async_trait::async_trait]
impl<F: FeatureFlags + 'static> TermMatchingRollout for FlaggedTermMatching<F> {
    #[tracing::instrument(skip_all, name = "search.term_matching_rollout")]
    async fn dynamic_enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        match self.0.load(&caller).await {
            Ok(flags) => flags.is_enabled(ENABLE_DYNAMIC_SEARCH_TERM_MATCHING),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load dynamic term matching flag");
                false
            }
        }
    }
}

/// Local stacks have no flag provider: dynamic matching is on for everyone.
pub struct LocalTermMatching;

#[async_trait::async_trait]
impl TermMatchingRollout for LocalTermMatching {
    async fn dynamic_enabled_for(&self, _caller: MacroUserIdStr<'_>) -> bool {
        true
    }
}
