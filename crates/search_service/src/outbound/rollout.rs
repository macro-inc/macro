//! Feature-flag backed rollouts of search features.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use feature_flags::FeatureFlags;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use tokio::time::Instant;
use tracing::Instrument;

use crate::domain::rollout::SearchRollout;

/// Dynamic multi-term matching on document content.
pub const DYNAMIC_TERM_MATCHING_FLAG: &str = "enable-dynamic-search-term-matching";

/// Database rows in unified search. The web app's flag of the same key
/// shows them in Cmd+K.
pub const DATABASE_ROW_SEARCH_FLAG: &str = "enable-database-row-search";

/// How long one caller's answer counts as current. After it, the next search
/// still gets that answer and starts a refresh.
const DECISION_LIFETIME: Duration = Duration::from_secs(300);

/// How long a lapsed answer is kept for a caller who has stopped searching.
const LAPSED_DECISION_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

/// Answers from one per-user flag without ever making a search wait on the
/// flag provider, which is a network call.
///
/// A search gets the caller's remembered answer, or "off" when there is none.
/// When that answer is missing or older than [`DECISION_LIFETIME`], one
/// background read per caller replaces it; a failed read is remembered as
/// "off". So the first search after the flag turns on for a caller, in each
/// process, still runs strict, and the next one is dynamic.
pub struct FlaggedRollout<F> {
    shared: Arc<Shared<F>>,
}

struct Shared<F> {
    flags: F,
    flag: &'static str,
    decisions: Mutex<Decisions>,
}

#[derive(Default)]
struct Decisions {
    by_caller: HashMap<String, Decision>,
    /// Callers whose answer is being read right now.
    refreshing: HashSet<String>,
    /// When lapsed entries are next dropped; `None` until the first answer.
    prune_at: Option<Instant>,
}

#[derive(Clone, Copy)]
struct Decision {
    enabled: bool,
    expires_at: Instant,
}

impl<F> FlaggedRollout<F> {
    /// Answer `flag` from a flag provider; nothing is remembered yet.
    pub fn new(flags: F, flag: &'static str) -> Self {
        Self {
            shared: Arc::new(Shared {
                flags,
                flag,
                decisions: Mutex::new(Decisions::default()),
            }),
        }
    }
}

impl<F> Shared<F> {
    fn decisions(&self) -> MutexGuard<'_, Decisions> {
        self.decisions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The caller's remembered answer, and whether this search should start
    /// a refresh: the answer is missing or lapsed and no refresh is running.
    fn remembered(&self, caller: &str) -> (bool, bool) {
        let mut decisions = self.decisions();
        let remembered = decisions.by_caller.get(caller).copied();
        let enabled = remembered.is_some_and(|decision| decision.enabled);
        let is_current = remembered.is_some_and(|decision| decision.expires_at > Instant::now());
        let starts_refresh = !is_current && decisions.refreshing.insert(caller.to_owned());
        (enabled, starts_refresh)
    }

    fn remember(&self, caller: &str, enabled: bool) {
        let now = Instant::now();
        let mut decisions = self.decisions();
        decisions.refreshing.remove(caller);

        // Dropping long-lapsed entries once per lifetime keeps the map to
        // recent searchers, without a scan on every refresh.
        if decisions.prune_at.is_none_or(|prune_at| prune_at <= now) {
            decisions
                .by_caller
                .retain(|_, decision| decision.expires_at + LAPSED_DECISION_RETENTION > now);
            decisions.prune_at = Some(now + DECISION_LIFETIME);
        }
        decisions.by_caller.insert(
            caller.to_owned(),
            Decision {
                enabled,
                expires_at: now + DECISION_LIFETIME,
            },
        );
    }
}

impl<F: FeatureFlags + 'static> Shared<F> {
    async fn refresh(&self, caller: MacroUserIdStr<'static>) {
        let enabled = match self.flags.load(&caller).await {
            Ok(flags) => flags.is_enabled(self.flag),
            Err(error) => {
                tracing::warn!(error = ?error, flag = self.flag, "failed to load search rollout flag");
                false
            }
        };
        tracing::Span::current().record("enabled", enabled);
        self.remember(caller.as_ref(), enabled);
    }
}

#[async_trait::async_trait]
impl<F: FeatureFlags + 'static> SearchRollout for FlaggedRollout<F> {
    async fn enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool {
        let (enabled, starts_refresh) = self.shared.remembered(caller.as_ref());
        if starts_refresh {
            // Parented on the search's span so the read stays in its trace.
            let span = tracing::info_span!(
                "search.rollout_refresh",
                flag = self.shared.flag,
                enabled = tracing::field::Empty
            );
            let shared = self.shared.clone();
            let caller = caller.into_owned();
            tokio::spawn(async move { shared.refresh(caller).await }.instrument(span));
        }
        enabled
    }
}

/// Local stacks have no flag provider: every search rollout is on for everyone.
pub struct LocalRollout;

#[async_trait::async_trait]
impl SearchRollout for LocalRollout {
    async fn enabled_for(&self, _caller: MacroUserIdStr<'_>) -> bool {
        true
    }
}

#[cfg(test)]
mod test;
