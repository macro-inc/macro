//! Feature-flag backed rollout of dynamic multi-term matching.

use std::{
    collections::HashMap,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::time::Instant;

use crate::domain::term_matching::TermMatchingRollout;

const ENABLE_DYNAMIC_SEARCH_TERM_MATCHING: &str = "enable-dynamic-search-term-matching";

/// How long one caller's answer is reused. A rollout change reaches a caller
/// within this window; until then their searches skip the flag provider.
const DECISION_LIFETIME: Duration = Duration::from_secs(300);

/// Answers from the per-user flag, asking the provider at most once per
/// caller per [`DECISION_LIFETIME`]. The provider is a network call, and a
/// search must not wait on one per request. A failed read is remembered as
/// "off" for the same window, so an unreachable provider is not retried on
/// every search.
pub struct FlaggedTermMatching<F> {
    flags: F,
    decisions: Mutex<HashMap<String, Decision>>,
}

#[derive(Clone, Copy)]
struct Decision {
    enabled: bool,
    expires_at: Instant,
}

impl<F> FlaggedTermMatching<F> {
    /// Wrap a flag provider with an empty decision cache.
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            decisions: Mutex::new(HashMap::new()),
        }
    }

    fn remembered(&self, caller: &str) -> Option<bool> {
        let decisions = self
            .decisions
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let decision = decisions.get(caller)?;
        (decision.expires_at > Instant::now()).then_some(decision.enabled)
    }

    fn remember(&self, caller: &str, enabled: bool) {
        let now = Instant::now();
        let mut decisions = self
            .decisions
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        // Dropping lapsed entries here keeps the map to callers who searched
        // within one lifetime.
        decisions.retain(|_, decision| decision.expires_at > now);
        decisions.insert(
            caller.to_owned(),
            Decision {
                enabled,
                expires_at: now + DECISION_LIFETIME,
            },
        );
    }
}

#[async_trait::async_trait]
impl<F: FeatureFlags + 'static> TermMatchingRollout for FlaggedTermMatching<F> {
    #[tracing::instrument(
        skip_all,
        name = "search.term_matching_rollout",
        fields(cache_hit = tracing::field::Empty)
    )]
    async fn dynamic_enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        let remembered = self.remembered(caller.as_ref());
        tracing::Span::current().record("cache_hit", remembered.is_some());
        if let Some(enabled) = remembered {
            return enabled;
        }

        let enabled = match self.flags.load(&caller).await {
            Ok(flags) => flags.is_enabled(ENABLE_DYNAMIC_SEARCH_TERM_MATCHING),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load dynamic term matching flag");
                false
            }
        };
        self.remember(caller.as_ref(), enabled);
        enabled
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

#[cfg(test)]
mod test;
