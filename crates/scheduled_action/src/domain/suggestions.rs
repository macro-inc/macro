//! Routine suggestions: routines AI picks for one person from the catalog,
//! after reading their newest mail and what their workspace holds.
//!
//! AI may only pick catalog routines and fill their knobs with bounded
//! values ([`decode`]), or describe a request the drafter writes when the
//! person accepts it. A suggestion becomes a routine only when the person
//! saves it, with `suggestion_id` pointing back.

pub mod decode;
pub mod model;
pub mod ports;
pub mod prompt;

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::{DateTime, TimeDelta, Utc};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::{CATALOG, CatalogRoutine, CodeStep, catalog_routine};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use self::decode::{RawAnswer, answer_schema};
use self::model::{GenerationStatus, RoutineSuggestions, StoredGeneration, SuggestionPick};
use self::ports::{RoutineSuggestionApi, SuggestionRepo, SuggestionSources};
use self::prompt::{ExistingRoutine, PromptData, SYSTEM_PROMPT, WorkspaceSignals, user_prompt};
use super::models::ActionPolicyError;
use super::ports::{
    CodeRun, DraftCompletion, DraftModel, OutputSchema, RoutineCode, ScheduledActionService,
};

#[cfg(test)]
mod test;

/// The PostHog flag that turns routine suggestions on for a person.
pub const ROUTINE_SUGGESTIONS_FLAG: &str = "enable-routine-suggestions";
/// Suggestions are regenerated this long after the last, even when nothing
/// they read changed.
pub const REFRESH_AFTER: TimeDelta = TimeDelta::days(7);
/// A failed generation is retried on the next read after this long.
pub const RETRY_FAILED_AFTER: TimeDelta = TimeDelta::minutes(15);
/// A generation running longer than this is presumed dead (its process
/// stopped) and may be started again.
pub const RECLAIM_GENERATING_AFTER: TimeDelta = TimeDelta::minutes(5);
/// Inbox messages a generation reads.
pub const INBOX_MESSAGES: u16 = 40;

/// Reads the person's workspace as they can see it, as a dry run.
const SIGNALS_SOURCE: &str = include_str!("suggestions/signals.ts");

/// Whether reading `stored` at `now`, when its inputs are now `inputs`,
/// should start a generation.
pub fn needs_generation(
    stored: Option<&StoredGeneration>,
    inputs: &str,
    now: DateTime<Utc>,
) -> bool {
    let Some(stored) = stored else {
        return true;
    };
    match stored.status {
        GenerationStatus::Generating => stored.started_at < now - RECLAIM_GENERATING_AFTER,
        GenerationStatus::Failed => stored.started_at < now - RETRY_FAILED_AFTER,
        GenerationStatus::Ready => {
            let stale = stored
                .generated_at
                .is_none_or(|generated_at| generated_at < now - REFRESH_AFTER);
            stale || stored.inputs.as_deref() != Some(inputs)
        }
    }
}

/// The catalog routines AI may pick: all of them, except those whose trigger
/// asks AI a question first where this host can't answer one.
pub fn offered(conditions: bool) -> Vec<&'static CatalogRoutine> {
    CATALOG
        .iter()
        .filter(|routine| conditions || !has_condition(routine))
        .collect()
}

fn has_condition(routine: &CatalogRoutine) -> bool {
    routine.trigger["filters"]
        .as_array()
        .is_some_and(|filters| {
            filters
                .iter()
                .any(|filter| filter.get("condition").is_some())
        })
}

/// Serves each person's suggestions and generates them in the background.
pub struct RoutineSuggestionService<Actions, Repo, Sources, Code, Model, Flags> {
    generation: Generation<Actions, Repo, Sources, Code, Model>,
    flags: Option<Flags>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

impl<Actions, Repo, Sources, Code, Model, Flags>
    RoutineSuggestionService<Actions, Repo, Sources, Code, Model, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Code: RoutineCode,
    Model: DraftModel,
    Flags: FeatureFlags,
{
    /// Generations run on `tasks` and stop at `shutdown`; a stopped one is
    /// started again after [`RECLAIM_GENERATING_AFTER`]. Without `flags`
    /// suggestions are off for everyone.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        actions: Arc<Actions>,
        repo: Arc<Repo>,
        sources: Arc<Sources>,
        code: Arc<Code>,
        model: Arc<Model>,
        flags: Option<Flags>,
        conditions: bool,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            generation: Generation {
                actions,
                repo,
                sources,
                code,
                model,
                conditions,
            },
            flags,
            tasks,
            shutdown,
        }
    }

    async fn answer(
        &self,
        user: &MacroUserIdStr<'static>,
        status: GenerationStatus,
        generated_at: Option<DateTime<Utc>>,
    ) -> Result<RoutineSuggestions> {
        let mut suggestions = self.generation.repo.open(user).await?;
        for suggestion in &mut suggestions {
            suggestion.safe_default = safe_default(&suggestion.pick);
        }
        Ok(RoutineSuggestions {
            status,
            generated_at,
            suggestions,
        })
    }

    #[tracing::instrument(name = "routine.suggestions_flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        let Some(flags) = &self.flags else {
            bail!(ActionPolicyError::NotFound);
        };
        let enabled = flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; routine suggestions stay off"
                );
            })
            .is_ok_and(|snapshot| snapshot.is_enabled(ROUTINE_SUGGESTIONS_FLAG));
        if !enabled {
            bail!(ActionPolicyError::NotFound);
        }
        Ok(())
    }

    async fn start(&self, user: &MacroUserIdStr<'static>, now: DateTime<Utc>) -> Result<()> {
        let generation_id = Uuid::now_v7();
        let claimed = self
            .generation
            .repo
            .claim(user, generation_id, now, now - RECLAIM_GENERATING_AFTER)
            .await?;
        if claimed {
            self.spawn(user.clone(), generation_id);
        }
        Ok(())
    }

    fn spawn(&self, user: MacroUserIdStr<'static>, generation_id: Uuid) {
        // A child of the request's span, so the read and the generation it
        // started stay one trace.
        let span = tracing::info_span!(
            "routine.suggestions.generate",
            user_id = %user.as_ref(),
            %generation_id,
            inbox_messages = tracing::field::Empty,
            suggestions = tracing::field::Empty,
            dropped_suggestions = tracing::field::Empty,
            dropped_knob_values = tracing::field::Empty,
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

impl<Actions, Repo, Sources, Code, Model, Flags> RoutineSuggestionApi
    for RoutineSuggestionService<Actions, Repo, Sources, Code, Model, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Code: RoutineCode,
    Model: DraftModel,
    Flags: FeatureFlags + 'static,
{
    /// The person's suggestions. Starts a generation when there are none yet,
    /// what they read changed (an inbox or tool connected, routines added or
    /// removed), the last are older than [`REFRESH_AFTER`], or the last
    /// attempt failed a while ago. Earlier suggestions show meanwhile.
    #[tracing::instrument(name = "routine.suggestions.read", skip(self), fields(user_id = %user.as_ref(), started = tracing::field::Empty), err)]
    async fn suggestions(&self, user: &MacroUserIdStr<'static>) -> Result<RoutineSuggestions> {
        self.require_flag(user).await?;
        let now = Utc::now();
        let stored = self.generation.repo.generation(user).await?;
        let inputs = self.generation.inputs(user).await;
        let start = needs_generation(stored.as_ref(), &inputs, now);
        tracing::Span::current().record("started", start);
        let status = if start {
            self.start(user, now).await?;
            GenerationStatus::Generating
        } else {
            stored
                .as_ref()
                .map_or(GenerationStatus::Generating, |stored| stored.status)
        };
        self.answer(user, status, stored.and_then(|stored| stored.generated_at))
            .await
    }

    /// Starts a generation now, unless one is already running.
    #[tracing::instrument(name = "routine.suggestions.refresh", skip(self), fields(user_id = %user.as_ref()), err)]
    async fn refresh(&self, user: &MacroUserIdStr<'static>) -> Result<RoutineSuggestions> {
        self.require_flag(user).await?;
        let stored = self.generation.repo.generation(user).await?;
        self.start(user, Utc::now()).await?;
        self.answer(
            user,
            GenerationStatus::Generating,
            stored.and_then(|stored| stored.generated_at),
        )
        .await
    }

    /// The person isn't interested in suggestion `id`; it isn't suggested
    /// again.
    #[tracing::instrument(name = "routine.suggestions.dismiss", skip(self), fields(user_id = %user.as_ref(), suggestion_id = %id), err)]
    async fn dismiss(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        self.require_flag(user).await?;
        if !self.generation.repo.dismiss(user, id).await? {
            bail!(ActionPolicyError::NotFound);
        }
        Ok(())
    }
}

/// Whether `pick` may be switched on before its owner changes anything: only
/// a catalog routine marked so, never a request AI wrote.
pub fn safe_default(pick: &SuggestionPick) -> bool {
    match pick {
        SuggestionPick::Starter { key, .. } => {
            catalog_routine(key).is_some_and(|routine| routine.safe_default)
        }
        SuggestionPick::Request { .. } => false,
    }
}

struct Generation<Actions, Repo, Sources, Code, Model> {
    actions: Arc<Actions>,
    repo: Arc<Repo>,
    sources: Arc<Sources>,
    code: Arc<Code>,
    model: Arc<Model>,
    conditions: bool,
}

// Manual impl: the adapters sit behind `Arc` and need not be `Clone`.
impl<Actions, Repo, Sources, Code, Model> Clone
    for Generation<Actions, Repo, Sources, Code, Model>
{
    fn clone(&self) -> Self {
        Self {
            actions: Arc::clone(&self.actions),
            repo: Arc::clone(&self.repo),
            sources: Arc::clone(&self.sources),
            code: Arc::clone(&self.code),
            model: Arc::clone(&self.model),
            conditions: self.conditions,
        }
    }
}

impl<Actions, Repo, Sources, Code, Model> Generation<Actions, Repo, Sources, Code, Model>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Code: RoutineCode,
    Model: DraftModel,
{
    /// A fingerprint of what a generation would read that changes when the
    /// person connects an inbox or tool, or adds or removes a routine.
    /// A source that fails reads as empty, so a blip changes the
    /// fingerprint at most twice.
    async fn inputs(&self, user: &MacroUserIdStr<'static>) -> String {
        let (inboxes, tools, routines) = tokio::join!(
            self.sources.inbox_ids(user),
            self.sources.tools(user),
            self.actions.get_actions(user.clone(), true),
        );
        let mut inboxes = inboxes.unwrap_or_default();
        let mut tools = tools.unwrap_or_default();
        let mut routines: Vec<String> = routines
            .map(|listed| {
                listed
                    .into_iter()
                    .filter_map(|listed| listed.action.id)
                    .map(|id| id.to_string())
                    .collect()
            })
            .unwrap_or_default();
        inboxes.sort();
        tools.sort();
        routines.sort();
        let digest = Sha256::digest(
            format!(
                "inboxes:{}\ntools:{}\nroutines:{}",
                inboxes.join(","),
                tools.join(","),
                routines.join(",")
            )
            .as_bytes(),
        );
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    async fn run(&self, user: &MacroUserIdStr<'static>, generation_id: Uuid) {
        let span = tracing::Span::current();
        let inputs = self.inputs(user).await;
        let suggestions = match self.generate(user).await {
            Ok(suggestions) => suggestions,
            Err(error) => {
                span.record("outcome", "failed");
                tracing::warn!(error = ?error, "routine suggestion generation failed");
                let _ = self.repo.fail(user, generation_id).await.inspect_err(
                    |error| tracing::error!(error = ?error, "marking routine suggestions failed"),
                );
                return;
            }
        };
        match self
            .repo
            .complete(user, generation_id, &inputs, &suggestions, Utc::now())
            .await
        {
            Ok(true) => span.record("outcome", "ready"),
            // A refresh or a reclaim took over; its result wins.
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
    ) -> Result<Vec<model::CheckedSuggestion>> {
        let span = tracing::Span::current();
        let (inbox, tools, workspace, routines, dismissed) = tokio::join!(
            self.inbox(user),
            self.tools(user),
            self.workspace(user),
            self.routines(user),
            self.repo.dismissed(user),
        );
        let dismissed = dismissed?;
        span.record("inbox_messages", inbox.len());
        let offered = offered(self.conditions);
        let prompt = user_prompt(&PromptData {
            today: Utc::now(),
            catalog: &offered,
            routines: &routines,
            dismissed: &dismissed,
            inbox: &inbox,
            workspace: &workspace,
            tools: &tools,
        });
        let schema = OutputSchema {
            name: "RoutineSuggestions",
            description: "Catalog routines and requests picked for this person.",
            schema: answer_schema(),
        };
        let answer = self
            .model
            .complete(
                user,
                DraftCompletion {
                    instructions: SYSTEM_PROMPT,
                    prompt: &prompt,
                    schema: &schema,
                },
            )
            .instrument(tracing::info_span!("routine.suggestions.model"))
            .await
            .ok_or_else(|| anyhow::anyhow!("the model gave no answer"))?;
        let raw: RawAnswer = serde_json::from_value(answer)?;
        let dismissed_keys: HashSet<String> = dismissed
            .iter()
            .filter_map(|pick| match pick {
                SuggestionPick::Starter { key, .. } => Some(key.clone()),
                SuggestionPick::Request { .. } => None,
            })
            .collect();
        let (suggestions, dropped) = decode::decode(raw, &offered, &dismissed_keys);
        span.record("suggestions", suggestions.len());
        span.record("dropped_suggestions", dropped.suggestions);
        span.record("dropped_knob_values", dropped.knob_values);
        if suggestions.is_empty() {
            bail!("the model suggested no usable routines");
        }
        Ok(suggestions)
    }

    #[tracing::instrument(name = "routine.suggestions.inbox", skip_all, fields(messages = tracing::field::Empty))]
    async fn inbox(&self, user: &MacroUserIdStr<'static>) -> Vec<ports::InboxMessage> {
        let messages = self
            .sources
            .inbox(user, INBOX_MESSAGES)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "reading the inbox failed; suggesting without it"))
            .unwrap_or_default();
        tracing::Span::current().record("messages", messages.len());
        messages
    }

    #[tracing::instrument(name = "routine.suggestions.tools", skip_all)]
    async fn tools(&self, user: &MacroUserIdStr<'static>) -> Vec<String> {
        self.sources
            .tools(user)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "reading detected tools failed; suggesting without them"))
            .unwrap_or_default()
    }

    /// The person's calendar, tasks, documents, channels and CRM, read by a
    /// fixed code step as a dry run with their access. Empty where code
    /// can't run.
    #[tracing::instrument(name = "routine.suggestions.workspace", skip_all, fields(outcome = tracing::field::Empty))]
    async fn workspace(&self, user: &MacroUserIdStr<'static>) -> WorkspaceSignals {
        let span = tracing::Span::current();
        if self.code.sdk().is_none() {
            span.record("outcome", "unavailable");
            return WorkspaceSignals::default();
        }
        let step = CodeStep {
            id: None,
            title: "Read the workspace".to_owned(),
            summary: String::new(),
            source: SIGNALS_SOURCE.to_owned(),
            knobs: Vec::new(),
            sentence: None,
        };
        let now = Utc::now();
        let context = json!({
            "run": { "id": Uuid::now_v7().to_string(), "at": now, "timezone": "UTC", "dryRun": true, "previous": null, "lastSucceededAt": null },
            "routine": { "id": "routine-suggestions", "name": "Routine suggestions" },
            "trigger": { "kind": "manual", "by": user.as_ref() },
        });
        let outcome = self
            .code
            .run(
                user,
                CodeRun {
                    step: &step,
                    context: &context,
                    steps: &json!({}),
                    dry_run: true,
                },
            )
            .await;
        let signals = outcome
            .result
            .map_err(anyhow::Error::msg)
            .and_then(|value| Ok(serde_json::from_value::<WorkspaceSignals>(value)?));
        match signals {
            Ok(signals) => {
                span.record("outcome", "read");
                signals
            }
            Err(error) => {
                span.record("outcome", "failed");
                tracing::warn!(error = ?error, "reading the workspace failed; suggesting without it");
                WorkspaceSignals::default()
            }
        }
    }

    async fn routines(&self, user: &MacroUserIdStr<'static>) -> Vec<ExistingRoutine> {
        self.actions
            .get_actions(user.clone(), true)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "listing routines failed; suggesting without them"))
            .unwrap_or_default()
            .into_iter()
            .map(|listed| ExistingRoutine {
                name: listed.action.name,
                description: listed.action.description,
            })
            .collect()
    }
}
