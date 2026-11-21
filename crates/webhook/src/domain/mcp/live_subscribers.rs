//! Which users hold a live MCP Events subscription, kept in each process so
//! fan-out spends no query on an event whose audience holds none.

#[cfg(test)]
#[path = "live_subscribers_test.rs"]
mod test;

use super::ports::{McpSubscriptionError, McpSubscriptionRepo};
use std::collections::HashSet;
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Duration, Instant};

/// Most live subscriptions a refresh reads. With more, the set is unknown and
/// fan-out queries for every audience, as it would without the set. The
/// repository's SQL writes this limit plus one as a literal.
pub const LIVE_SUBSCRIBERS_MAX_ROWS: usize = 10_000;

/// How long a loaded set is trusted. Refreshes come every 2 s and a failed one
/// forgets the set, so a set this old means a refresh is hanging; fan-out
/// then queries for every audience rather than miss subscriptions made since.
pub const LIVE_SUBSCRIBERS_MAX_AGE: Duration = Duration::from_secs(5);

/// The users with a live subscription, as of the last refresh. Cheap to
/// clone; clones share the set.
///
/// A subscription made in any process reaches the set on the next refresh
/// that starts after it commits, so its events until then pass unmatched:
/// up to one refresh interval plus that refresh's own time. A deleted or expired
/// one may linger until then; matching rereads every row it uses, so that
/// costs a query, never a delivery.
#[derive(Clone, Default)]
pub struct McpLiveSubscribers {
    state: Arc<RwLock<State>>,
}

#[derive(Default)]
enum State {
    /// No refresh has finished yet.
    #[default]
    NotLoaded,
    /// More than [`LIVE_SUBSCRIBERS_MAX_ROWS`] live subscriptions.
    TooMany,
    /// The subscribers, read by a refresh that started at `at`.
    Loaded {
        users: Arc<HashSet<String>>,
        at: Instant,
    },
}

impl McpLiveSubscribers {
    /// The members of `audience` with a live subscription, or `None` when the
    /// set is not known (not loaded yet, too large, or too old), in which case
    /// every member must be matched.
    pub fn narrow(&self, audience: &[String]) -> Option<Vec<String>> {
        self.narrow_at(audience, Instant::now())
    }

    fn narrow_at(&self, audience: &[String], now: Instant) -> Option<Vec<String>> {
        let users = match &*self.state.read().unwrap_or_else(PoisonError::into_inner) {
            State::Loaded { users, at }
                if now.saturating_duration_since(*at) <= LIVE_SUBSCRIBERS_MAX_AGE =>
            {
                Arc::clone(users)
            }
            State::Loaded { .. } | State::NotLoaded | State::TooMany => return None,
        };
        Some(
            audience
                .iter()
                .filter(|user| users.contains(user.as_str()))
                .cloned()
                .collect(),
        )
    }

    /// Reload the set with one query. On failure the set is forgotten, so
    /// fan-out matches every audience member until a refresh succeeds.
    ///
    /// Not spanned: it runs every few seconds in every replica, and a trace per
    /// round would be noise. A failure is the caller's to log.
    pub async fn refresh<R: McpSubscriptionRepo>(
        &self,
        repo: &R,
    ) -> Result<(), McpSubscriptionError> {
        // Taken before the read, so the set's age covers the query's time.
        let started = Instant::now();
        let user_ids = match repo.list_live_subscriber_ids().await {
            Ok(user_ids) => user_ids,
            Err(error) => {
                *self.state.write().unwrap_or_else(PoisonError::into_inner) = State::NotLoaded;
                return Err(McpSubscriptionError::internal(error));
            }
        };
        let state = if user_ids.len() > LIVE_SUBSCRIBERS_MAX_ROWS {
            State::TooMany
        } else {
            State::Loaded {
                users: Arc::new(user_ids.into_iter().collect()),
                at: started,
            }
        };
        *self.state.write().unwrap_or_else(PoisonError::into_inner) = state;
        Ok(())
    }
}
