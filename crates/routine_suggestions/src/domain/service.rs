//! When suggestions are generated, and the generation itself.

use std::sync::Arc;

use chrono::{DateTime, TimeDelta, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;
use uuid::Uuid;

use super::decode::{RawSuggestions, decode_suggestions, response_schema};
use super::model::{
    RoutineSuggestion, RoutineSuggestionSet, StoredSuggestionSet, SuggestionSetStatus,
};
use super::ports::{
    InboxReader, RoutineSuggestionError, RoutineSuggestionRepo, SuggestionGenerator,
};
use super::prompt::{SYSTEM_PROMPT, user_prompt};

#[cfg(test)]
mod test;

/// A ready set older than this is regenerated the next time it is read, so
/// suggestions follow the user's work as it changes.
pub const REFRESH_AFTER: TimeDelta = TimeDelta::days(3);
/// A failed generation is retried on the next read after this long.
pub const RETRY_FAILED_AFTER: TimeDelta = TimeDelta::minutes(15);
/// A generation running longer than this is presumed dead (its process
/// stopped) and may be claimed again.
pub const RECLAIM_GENERATING_AFTER: TimeDelta = TimeDelta::minutes(5);
/// Inbox messages a generation reads.
pub const INBOX_MESSAGES: u16 = 40;

impl From<rootcause::Report> for RoutineSuggestionError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> RoutineSuggestionError {
    RoutineSuggestionError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Whether reading `stored` at `now` should start a generation.
pub fn needs_generation(stored: Option<&StoredSuggestionSet>, now: DateTime<Utc>) -> bool {
    let Some(stored) = stored else {
        return true;
    };
    match stored.status {
        SuggestionSetStatus::Generating => stored.started_at < now - RECLAIM_GENERATING_AFTER,
        SuggestionSetStatus::Ready => stored
            .generated_at
            .is_none_or(|generated_at| generated_at < now - REFRESH_AFTER),
        SuggestionSetStatus::Failed => stored.started_at < now - RETRY_FAILED_AFTER,
    }
}

/// Serves each user's suggestions and generates them in the background.
pub struct RoutineSuggestionService<R, I, G> {
    generation: Generation<R, I, G>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

impl<R, I, G> RoutineSuggestionService<R, I, G>
where
    R: RoutineSuggestionRepo,
    I: InboxReader,
    G: SuggestionGenerator,
{
    /// Builds the service. Generations run on `tasks` and stop at
    /// `shutdown`; a stopped one is claimed again after
    /// [`RECLAIM_GENERATING_AFTER`].
    pub fn new(
        repo: R,
        inbox: I,
        generator: G,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            generation: Generation {
                repo: Arc::new(repo),
                inbox: Arc::new(inbox),
                generator: Arc::new(generator),
            },
            tasks,
            shutdown,
        }
    }

    /// The user's suggestions. Starts a generation when there are none yet,
    /// the last ones are older than [`REFRESH_AFTER`], or the last attempt
    /// failed a while ago; earlier suggestions stay in the answer meanwhile.
    #[tracing::instrument(skip(self), fields(user_id = %user.as_ref()), err)]
    pub async fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<RoutineSuggestionSet, RoutineSuggestionError> {
        let now = Utc::now();
        let stored = self.generation.repo.get(user).await.map_err(internal)?;
        match stored {
            Some(stored) if !needs_generation(Some(&stored), now) => Ok(stored.into()),
            stored => self.start(user, stored, now).await,
        }
    }

    /// Starts a new generation now, unless one is already running.
    #[tracing::instrument(skip(self), fields(user_id = %user.as_ref()), err)]
    pub async fn refresh(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<RoutineSuggestionSet, RoutineSuggestionError> {
        let stored = self.generation.repo.get(user).await.map_err(internal)?;
        self.start(user, stored, Utc::now()).await
    }

    async fn start(
        &self,
        user: &MacroUserIdStr<'static>,
        stored: Option<StoredSuggestionSet>,
        now: DateTime<Utc>,
    ) -> Result<RoutineSuggestionSet, RoutineSuggestionError> {
        let generation_id = Uuid::now_v7();
        let claimed = self
            .generation
            .repo
            .claim(user, generation_id, now, now - RECLAIM_GENERATING_AFTER)
            .await
            .map_err(internal)?;
        if claimed {
            self.spawn(user.clone(), generation_id);
        }
        // Claimed or not, a generation is now running for the user.
        Ok(match stored {
            Some(stored) => RoutineSuggestionSet {
                status: SuggestionSetStatus::Generating,
                suggestions: stored.suggestions,
                generated_at: stored.generated_at,
            },
            None => RoutineSuggestionSet::empty(SuggestionSetStatus::Generating),
        })
    }

    fn spawn(&self, user: MacroUserIdStr<'static>, generation_id: Uuid) {
        // A child of the request's span, so the request and the generation it
        // started stay one trace.
        let span = tracing::info_span!(
            "routine_suggestions.generate",
            user_id = %user.as_ref(),
            %generation_id,
            inbox_messages = tracing::field::Empty,
            suggestions = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let generation = self.generation.clone();
        let shutdown = self.shutdown.clone();
        self.tasks.spawn(
            async move {
                tokio::select! {
                    () = shutdown.cancelled() => {
                        tracing::Span::current().record("outcome", "cancelled");
                    }
                    () = generation.run(&user, generation_id) => {}
                }
            }
            .instrument(span),
        );
    }
}

struct Generation<R, I, G> {
    repo: Arc<R>,
    inbox: Arc<I>,
    generator: Arc<G>,
}

// Manual impl: the adapters sit behind `Arc` and need not be `Clone`.
impl<R, I, G> Clone for Generation<R, I, G> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
            inbox: self.inbox.clone(),
            generator: self.generator.clone(),
        }
    }
}

impl<R, I, G> Generation<R, I, G>
where
    R: RoutineSuggestionRepo,
    I: InboxReader,
    G: SuggestionGenerator,
{
    async fn run(&self, user: &MacroUserIdStr<'static>, generation_id: Uuid) {
        let span = tracing::Span::current();
        let suggestions = match self.generate(user).await {
            Ok(suggestions) => suggestions,
            Err(error) => {
                span.record("outcome", "failed");
                tracing::warn!(error = ?error, "routine suggestion generation failed");
                let _ = self
                    .repo
                    .fail(user, generation_id)
                    .await
                    .inspect_err(|error| {
                        tracing::error!(error = ?error, "marking routine suggestions failed");
                    });
                return;
            }
        };
        match self
            .repo
            .complete(user, generation_id, &suggestions, Utc::now())
            .await
        {
            Ok(true) => span.record("outcome", "ready"),
            // A refresh or a reclaim took the row over; its result wins.
            Ok(false) => span.record("outcome", "superseded"),
            Err(error) => {
                tracing::error!(error = ?error, "storing routine suggestions");
                span.record("outcome", "store_failed")
            }
        };
    }

    async fn generate(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<RoutineSuggestion>, RoutineSuggestionError> {
        let inbox = self
            .inbox
            .recent_messages(user, INBOX_MESSAGES)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "reading the inbox failed; suggesting without it");
            })
            .unwrap_or_default();
        tracing::Span::current().record("inbox_messages", inbox.len());
        let answer = self
            .generator
            .generate(
                user,
                SYSTEM_PROMPT,
                user_prompt(Utc::now(), &inbox),
                response_schema(),
            )
            .await
            .map_err(internal)?;
        let raw: RawSuggestions = serde_json::from_value(answer).map_err(internal)?;
        let suggestions = decode_suggestions(raw);
        tracing::Span::current().record("suggestions", suggestions.len());
        if suggestions.is_empty() {
            return Err(rootcause::report!("the model suggested no usable routines").into());
        }
        Ok(suggestions)
    }
}
