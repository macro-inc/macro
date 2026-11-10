//! The per-user rollout of document programs, read from PostHog.
use agent_code_mode::domain::{DOCUMENT_PROGRAMS_FLAG, DocumentProgramGate};
use async_trait::async_trait;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use std::{
    num::NonZeroUsize,
    sync::{Mutex, PoisonError},
    time::Duration,
};
use tokio::time::Instant;

/// How long a user's rollout answer is reused before PostHog is asked again.
const ROLLOUT_TTL: Duration = Duration::from_secs(60);
/// Users whose answers are kept; past it the least recent is asked again.
const CACHED_USERS: NonZeroUsize = NonZeroUsize::MIN.saturating_add(4095);

/// Document programs roll out per user through [`DOCUMENT_PROGRAMS_FLAG`].
/// Each build and run asks, so a user's answer is kept for [`ROLLOUT_TTL`];
/// when PostHog fails, the last answer stands, and a user with none is
/// refused. A local stack always runs them, matching the web flag's dev
/// default: its PostHog key is often a placeholder that PostHog refuses.
/// Without a flag provider (no PostHog key) they are off.
pub struct FlaggedDocumentPrograms<F> {
    flags: Option<F>,
    local: bool,
    answers: Mutex<lru::LruCache<MacroUserIdStr<'static>, Answer>>,
}

#[derive(Clone, Copy)]
struct Answer {
    enabled: bool,
    read_at: Instant,
}

impl<F> FlaggedDocumentPrograms<F> {
    /// `local` admits everyone, for a local stack.
    pub fn new(flags: Option<F>, local: bool) -> Self {
        Self {
            flags,
            local,
            answers: Mutex::new(lru::LruCache::new(CACHED_USERS)),
        }
    }
}

#[async_trait]
impl<F: FeatureFlags + 'static> DocumentProgramGate for FlaggedDocumentPrograms<F> {
    #[tracing::instrument(
        name = "document_programs.rollout",
        skip_all,
        fields(cache = tracing::field::Empty, allowed = tracing::field::Empty)
    )]
    async fn allows(&self, user: &MacroUserIdStr<'static>) -> bool {
        if self.local {
            return true;
        }
        let Some(flags) = &self.flags else {
            return false;
        };
        let span = tracing::Span::current();
        let known = self
            .answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(user)
            .copied();
        if let Some(answer) = known
            && answer.read_at.elapsed() < ROLLOUT_TTL
        {
            span.record("cache", "hit");
            span.record("allowed", answer.enabled);
            return answer.enabled;
        }

        let enabled = match flags.load(user).await {
            Ok(snapshot) => {
                let enabled = snapshot.is_enabled(DOCUMENT_PROGRAMS_FLAG);
                self.answers
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .put(
                        user.clone(),
                        Answer {
                            enabled,
                            read_at: Instant::now(),
                        },
                    );
                span.record("cache", "miss");
                enabled
            }
            Err(error) => {
                // Keep the last answer for another interval, so an outage
                // doesn't add PostHog's timeout to every build and run.
                if let Some(answer) = known {
                    self.answers
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .put(
                            user.clone(),
                            Answer {
                                read_at: Instant::now(),
                                ..answer
                            },
                        );
                }
                let last = known.is_some_and(|answer| answer.enabled);
                tracing::warn!(
                    ?error,
                    reused = known.is_some(),
                    "could not read document program rollout"
                );
                span.record("cache", if known.is_some() { "stale" } else { "failed" });
                last
            }
        };
        span.record("allowed", enabled);
        enabled
    }
}

#[cfg(test)]
mod test;
