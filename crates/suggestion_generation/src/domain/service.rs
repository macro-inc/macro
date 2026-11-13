//! Generations: runs of hidden agent sessions that write a person's suggestions
//! and routine suggestions.
//!
//! A generation starts at onboarding ([`GenerationService::start`]), in the
//! person's night ([`GenerationService::nightly`]) or when they ask for fresh
//! suggestions ([`GenerationService::regenerate`]). It runs one suggestions
//! session and the routines sessions of the [`SessionLayout`] at once, each
//! for the person, hidden and non-billable (`SessionBilling::NonBillable`),
//! each told what its kind's crate briefs it with. A session may only call
//! its kind's tools while its row in `suggestion_generation_session` is
//! open; the tools decide and log everything else. Code here only schedules
//! sessions, waits for their turn and cleans up: no reconciling, ranking or
//! retiring.
//!
//! The lifecycles are tables of their own, tested exhaustively: a
//! generation's in [`super::generation`], a session's in [`super::session`],
//! the nightly decision in [`super::nightly`] and the weekly routines
//! cadence in [`super::cadence`]. Code here applies them.

use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::{
    AgentSessionId, SessionBilling, SessionSource, SessionVisibility,
};
use agent_session::domain::routines::{
    PrepareRoutineSession, PromptRoutineSession, RoutineSessionAction, RoutineSessionError,
    RoutineSessions, ValidateRoutineSession,
};
use chrono::{DateTime, TimeDelta, Utc};
use chrono_tz::Tz;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use scheduled_action::domain::suggestions::ROUTINE_SUGGESTIONS_FLAG;
use scheduled_action::domain::suggestions::model::RoutineGenerationReport;
use scheduled_action::domain::suggestions::ports::RoutineSuggestionApi;
use suggestions::domain::model::{GenerationTrigger, SessionKind};
use suggestions::domain::ports::SuggestionApi;
use suggestions::domain::service::SUGGESTIONS_FLAG;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::cadence::{routines_due, routines_ok};
use super::generation::{
    Admission, GenerationEvent, GenerationOverview, SessionResult, admit, conclude,
};
use super::model::{
    GenerationAgent, GenerationError, NewGeneration, SessionLayout, StaleSession, StartOutcome,
};
use super::night;
use super::nightly::{NightlyDecision, NightlyOutcome, Plan, decide, needs_plan};
use super::ports::{GenerationRepo, Plans, StoredSessions};
use super::session::{Cleanup, CleanupEvent, Poll, SessionEnding, Work, poll};

#[cfg(test)]
mod test;

/// The longest an onboarding routines session runs: the person is waiting.
pub const ONBOARDING_ROUTINES_TIMEOUT: Duration = Duration::from_secs(240);
/// The longest a nightly or manual routines session runs: it reviews what
/// it suggested before, too.
pub const NIGHTLY_ROUTINES_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The longest an onboarding suggestions session runs: the person is waiting.
pub const ONBOARDING_SUGGESTIONS_TIMEOUT: Duration = Duration::from_secs(240);
/// The longest a nightly or manual suggestions session runs: it researches
/// the whole workspace.
pub const NIGHTLY_SUGGESTIONS_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How long a session may stay open before the sweep ends it as
/// interrupted, even while its generation runs: longer than any session.
pub const STALE_SESSION: TimeDelta = TimeDelta::minutes(20);
/// How often a running generation tells storage it is alive.
pub const HEARTBEAT: Duration = Duration::from_secs(30);
/// How long a generation's heartbeat may be silent before the sweep marks
/// it interrupted and its person may start the next attempt.
pub const HEARTBEAT_LOST: TimeDelta = TimeDelta::minutes(3);
/// How long an ended session waits between deletes: after its own process
/// tried, or a sweep before.
pub const CLEANUP_RETRY: TimeDelta = TimeDelta::minutes(5);
pub use super::night::NIGHT;
/// Nightly generations one process runs at once. A nightly run is one
/// suggestions session of up to 15 minutes (a routines one too, weekly), so with
/// the harness's two processes and a tick every 5 minutes this starts about
/// 48 people an hour, roughly 150 per zone's three-hour night: sized for
/// the flagged rollout. `suggestion.nightly_short` says when it falls short.
pub const MAX_NIGHTLY_RUNS: usize = 6;
/// How many times a tick reads who is due while it has room.
const DUE_BATCHES: usize = 4;
const SWEEP_BATCH: u16 = 64;
/// How long the change log keeps an entry.
pub const CHANGES_KEPT: TimeDelta = TimeDelta::days(90);
/// Change-log entries one sweep deletes at most.
const PRUNE_BATCH: u16 = 1000;
const FIRST_POLL: Duration = Duration::from_millis(500);
const MAX_POLL: Duration = Duration::from_secs(5);
const MAX_STATUS_FAILURES: u8 = 5;

/// Starts and runs generations.
pub struct GenerationService<Repo, Sessions, Routines, SuggestionFeed, Flags> {
    runner: Arc<Runner<Repo, Sessions, Routines, SuggestionFeed>>,
    flags: Option<Flags>,
    /// Who is on a paid plan; without it, nobody gets a nightly run.
    plans: Option<Arc<dyn Plans>>,
    nightly: Arc<Semaphore>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

/// What a generation needs, shared with its background task.
struct Runner<Repo, Sessions, Routines, SuggestionFeed> {
    repo: Arc<Repo>,
    sessions: Arc<Sessions>,
    routines: Arc<Routines>,
    suggestions: Arc<SuggestionFeed>,
    /// Which sessions are stored; without it, a failed delete is never
    /// taken for a session already gone.
    stored: Option<Arc<dyn StoredSessions>>,
    agent: GenerationAgent,
    layout: SessionLayout,
}

/// One generation, as it runs.
struct Run {
    generation: Uuid,
    started_at: DateTime<Utc>,
    user: MacroUserIdStr<'static>,
    trigger: GenerationTrigger,
    timezone: Tz,
    suggestions: bool,
    routines: bool,
}

/// What stops a generation's sessions early.
#[derive(Clone, Copy)]
struct Stop<'a> {
    /// The process is stopping.
    shutdown: &'a CancellationToken,
    /// Storage no longer counts the generation running: the sweep marked it
    /// interrupted while its heartbeat couldn't be written.
    lost: &'a CancellationToken,
}

impl Stop<'_> {
    fn any(self) -> bool {
        self.shutdown.is_cancelled() || self.lost.is_cancelled()
    }
}

/// One session's end and what it did.
struct Ended {
    ending: SessionEnding,
    work: Work,
    /// The session, when its cleanup waits for its generation's end to be
    /// stored: its process is stopping.
    deferred: Option<RoutineSessionAction>,
}

/// One routines session group's end, and whether it took a second try.
struct GroupEnded {
    ended: Ended,
    retried: bool,
}

/// How many people a nightly tick left each way.
#[derive(Default)]
struct NightlyCounts {
    started: usize,
    skipped: usize,
    dropped: usize,
    missed: usize,
    retrying: usize,
    waiting: usize,
}

impl NightlyCounts {
    fn add(&mut self, outcome: NightlyOutcome) {
        match outcome {
            NightlyOutcome::Started => self.started += 1,
            NightlyOutcome::Skipped => self.skipped += 1,
            NightlyOutcome::Dropped => self.dropped += 1,
            NightlyOutcome::Missed => self.missed += 1,
            NightlyOutcome::Retrying => self.retrying += 1,
            // A tick never cuts a run short.
            NightlyOutcome::CutShort => {}
        }
    }
}

/// How long a `kind` session of a `trigger` generation may run.
fn timeout(trigger: GenerationTrigger, kind: SessionKind) -> Duration {
    match (trigger, kind) {
        (GenerationTrigger::Onboarding, SessionKind::Suggestions) => ONBOARDING_SUGGESTIONS_TIMEOUT,
        (GenerationTrigger::Onboarding, SessionKind::Routines) => ONBOARDING_ROUTINES_TIMEOUT,
        (GenerationTrigger::Nightly | GenerationTrigger::Manual, SessionKind::Suggestions) => {
            NIGHTLY_SUGGESTIONS_TIMEOUT
        }
        (GenerationTrigger::Nightly | GenerationTrigger::Manual, SessionKind::Routines) => {
            NIGHTLY_ROUTINES_TIMEOUT
        }
    }
}

impl<Repo, Sessions, Routines, SuggestionFeed, Flags>
    GenerationService<Repo, Sessions, Routines, SuggestionFeed, Flags>
where
    Repo: GenerationRepo,
    Sessions: RoutineSessions,
    Routines: RoutineSuggestionApi,
    SuggestionFeed: SuggestionApi,
    Flags: FeatureFlags + 'static,
{
    /// Generations run on `tasks` and stop at `shutdown`. Without `flags`
    /// nothing generates.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        repo: Arc<Repo>,
        sessions: Arc<Sessions>,
        routines: Arc<Routines>,
        suggestions: Arc<SuggestionFeed>,
        flags: Option<Flags>,
        agent: GenerationAgent,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            runner: Arc::new(Runner {
                repo,
                sessions,
                routines,
                suggestions,
                stored: None,
                agent,
                layout: SessionLayout::default(),
            }),
            flags,
            plans: None,
            nightly: Arc::new(Semaphore::new(MAX_NIGHTLY_RUNS)),
            tasks,
            shutdown,
        }
    }

    /// Read who is on a paid plan from `plans`: only they get nightly runs.
    pub fn with_plans(mut self, plans: Arc<dyn Plans>) -> Self {
        self.plans = Some(plans);
        self
    }

    /// Split routine suggestions across `layout`'s sessions.
    pub fn with_layout(mut self, layout: SessionLayout) -> Self {
        if let Some(runner) = Arc::get_mut(&mut self.runner) {
            runner.layout = layout;
        }
        self
    }

    /// Ask `stored` whether a session that couldn't be deleted is gone.
    pub fn with_stored_sessions(mut self, stored: Arc<dyn StoredSessions>) -> Self {
        if let Some(runner) = Arc::get_mut(&mut self.runner) {
            runner.stored = Some(stored);
        }
        self
    }

    /// The person's plan; without plans, nobody pays.
    async fn plan(&self, user: &MacroUserIdStr<'static>) -> Plan {
        let Some(plans) = &self.plans else {
            return Plan::Unpaid;
        };
        match plans.paid(user).await {
            Ok(true) => Plan::Paid,
            Ok(false) => Plan::Unpaid,
            Err(error) => {
                tracing::warn!(?error, "could not read a plan");
                Plan::Unknown
            }
        }
    }

    /// Which kinds are on for the person: suggestions, routine suggestions.
    async fn kinds(&self, user: &MacroUserIdStr<'_>) -> (bool, bool) {
        let Some(flags) = &self.flags else {
            return (false, false);
        };
        match flags.load(user).await {
            Ok(flags) => (
                flags.is_enabled(SUGGESTIONS_FLAG),
                flags.is_enabled(ROUTINE_SUGGESTIONS_FLAG),
            ),
            Err(error) => {
                tracing::warn!(?error, "feature flags unavailable; nothing generates");
                (false, false)
            }
        }
    }

    /// Start the person's generation for `trigger` in the background, if
    /// [`admit`] lets it: onboarding once, nightly once a night, manual once
    /// an hour, and one cut short again as its next attempt. Not found when
    /// what `trigger` runs is off: suggestions for a manual run, both kinds
    /// for the others.
    pub async fn start(
        &self,
        user: &MacroUserIdStr<'static>,
        trigger: GenerationTrigger,
        timezone: Tz,
    ) -> Result<StartOutcome, GenerationError> {
        self.launch(user, trigger, timezone, None).await
    }

    /// Start the fresh suggestions the person asked for: a manual
    /// generation, nightly-style. Refused while one of theirs runs, and
    /// within [`super::generation::REGENERATE_EVERY`] of their last.
    pub async fn regenerate(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Tz,
    ) -> Result<(), GenerationError> {
        match self
            .launch(user, GenerationTrigger::Manual, timezone, None)
            .await?
        {
            StartOutcome::Started => Ok(()),
            StartOutcome::Refused(Admission::Running) => Err(GenerationError::Running),
            StartOutcome::Refused(Admission::Cooldown { available_at }) => {
                Err(GenerationError::Cooldown { available_at })
            }
            // A manual run has a window, and runs the suggestions session
            // whenever suggestions are on.
            StartOutcome::Refused(admission @ (Admission::Done | Admission::Start { .. })) => {
                Err(GenerationError::Internal(rootcause::report!(
                    "a manual generation was refused as {admission:?}"
                )))
            }
            StartOutcome::Nothing => Err(GenerationError::NotFound),
        }
    }

    /// The person's generations now: whether one runs, how the last ended,
    /// and when they may ask for fresh suggestions.
    pub async fn overview(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<GenerationOverview, GenerationError> {
        let (suggestions, _) = self.kinds(user).await;
        if !suggestions {
            return Err(GenerationError::NotFound);
        }
        let facts = self
            .runner
            .repo
            .overview(user)
            .await
            .map_err(GenerationError::internal)?;
        Ok(GenerationOverview::new(facts, Utc::now()))
    }

    /// Start a generation, holding `permit` while it runs.
    #[tracing::instrument(name = "suggestion.generation.start", skip_all, fields(
        suggestion.generation.trigger = trigger.as_ref(),
        suggestion.generation.admission = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.attempt = tracing::field::Empty,
        suggestion.generation.suggestions = tracing::field::Empty,
        suggestion.generation.routines = tracing::field::Empty,
    ), err)]
    async fn launch(
        &self,
        user: &MacroUserIdStr<'static>,
        trigger: GenerationTrigger,
        timezone: Tz,
        permit: Option<OwnedSemaphorePermit>,
    ) -> Result<StartOutcome, GenerationError> {
        let (suggestions, routines_on) = self.kinds(user).await;
        let off = match trigger {
            GenerationTrigger::Manual => !suggestions,
            GenerationTrigger::Onboarding | GenerationTrigger::Nightly => {
                !suggestions && !routines_on
            }
        };
        if off {
            return Err(GenerationError::NotFound);
        }
        let now = Utc::now();
        let repo = &self.runner.repo;
        let span = tracing::Span::current();
        let facts = repo
            .admission(user, trigger)
            .await
            .map_err(GenerationError::internal)?;
        let admission = admit(trigger, facts.running, facts.latest, now);
        span.record("suggestion.generation.admission", admission.as_ref());
        let Admission::Start { attempt } = admission else {
            return Ok(StartOutcome::Refused(admission));
        };
        // Routine suggestions come at onboarding, then once a week.
        let routines = routines_on
            && match trigger {
                GenerationTrigger::Onboarding => true,
                GenerationTrigger::Nightly | GenerationTrigger::Manual => {
                    let last_ok = repo
                        .last_routines_ok(user)
                        .await
                        .map_err(GenerationError::internal)?;
                    routines_due(trigger, last_ok, now)
                }
            };
        span.record("suggestion.generation.suggestions", suggestions);
        span.record("suggestion.generation.routines", routines);
        if !suggestions && !routines {
            return Ok(StartOutcome::Nothing);
        }
        if trigger == GenerationTrigger::Onboarding && self.plan(user).await == Plan::Paid {
            repo.see(
                user,
                timezone.name(),
                now,
                night::upcoming(user, timezone, now),
            )
            .await
            .map_err(GenerationError::internal)?;
        }
        let new = NewGeneration {
            id: Uuid::now_v7(),
            user: user.clone(),
            trigger,
            attempt,
            started_at: now,
            after: facts.latest.map(|latest| latest.started_at),
        };
        // Another start since admission read: that one runs.
        if !repo
            .insert(&new)
            .await
            .map_err(GenerationError::internal)?
        {
            return Ok(StartOutcome::Refused(Admission::Running));
        }
        let generation = new.id;
        span.record("suggestion.generation.id", generation.to_string());
        span.record("suggestion.generation.attempt", attempt);
        // Asked for by the person (onboarding, manual): a child of the
        // request, one trace. A nightly tick starts many people's: each is
        // its own trace, linked to the tick, so a trace never holds two
        // people's runs.
        let parent = match trigger {
            GenerationTrigger::Onboarding | GenerationTrigger::Manual => span.id(),
            GenerationTrigger::Nightly => None,
        };
        let run_span = tracing::info_span!(
            parent: parent,
            "suggestion.generation",
            suggestion.generation.id = %generation,
            suggestion.generation.trigger = trigger.as_ref(),
            suggestion.generation.attempt = attempt,
            suggestion.generation.suggestions = suggestions,
            suggestion.generation.routines = routines,
            suggestion.generation.feed_changes = tracing::field::Empty,
            suggestion.generation.routines_suggested = tracing::field::Empty,
            suggestion.generation.retries = tracing::field::Empty,
            suggestion.generation.outcome = tracing::field::Empty,
            user.id = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        if trigger == GenerationTrigger::Nightly {
            run_span.follows_from(&span);
        }
        // Its sessions' tool calls arrive without this trace's context: they
        // record its id, kept with the generation, to be joined to it.
        if let Some(trace) = run_span.in_scope(macro_tower_layers::current_trace_id)
            && let Err(error) = repo.traced(generation, &trace).await
        {
            tracing::warn!(?error, "could not keep a generation's trace id");
        }
        // The person's opaque id, to find their generations by.
        match repo.account(user).await {
            Ok(Some(account)) => {
                run_span.record("user.id", account.to_string());
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(?error, "could not read a person's account id"),
        }
        let run = Run {
            generation,
            started_at: now,
            user: user.clone(),
            trigger,
            timezone,
            suggestions,
            routines,
        };
        let runner = Arc::clone(&self.runner);
        let shutdown = self.shutdown.clone();
        self.tasks.spawn(
            async move {
                runner.run(run, shutdown).await;
                drop(permit);
            }
            .instrument(run_span),
        );
        Ok(StartOutcome::Started)
    }

    /// Start nightly generations for the people due one, as many as this
    /// process has room for, and record what became of each
    /// ([`decide`]). How many started.
    #[tracing::instrument(name = "suggestion.nightly", skip_all, fields(
        suggestion.nightly.started = tracing::field::Empty,
        suggestion.nightly.skipped = tracing::field::Empty,
        suggestion.nightly.dropped = tracing::field::Empty,
        suggestion.nightly.missed = tracing::field::Empty,
        suggestion.nightly.retrying = tracing::field::Empty,
        suggestion.nightly.waiting = tracing::field::Empty,
    ), err)]
    pub async fn nightly(&self) -> Result<usize, GenerationError> {
        let now = Utc::now();
        let repo = &self.runner.repo;
        let mut counts = NightlyCounts::default();
        // People dropped or passed over don't use up the tick: keep reading
        // who is due while there is room, a bounded number of times. Each
        // person recorded leaves the due set until their next run.
        'batches: for _ in 0..DUE_BATCHES {
            let room = self.nightly.available_permits();
            if room == 0 {
                break;
            }
            let due = repo
                .due(now, u16::try_from(room * 2).unwrap_or(u16::MAX))
                .await
                .map_err(GenerationError::internal)?;
            if due.is_empty() {
                break;
            }
            for (index, member) in due.iter().enumerate() {
                let room = self.nightly.available_permits();
                let plan = if needs_plan(member, now, room) {
                    Some(self.plan(&member.user).await)
                } else {
                    None
                };
                let outcome = match decide(member, now, room, plan) {
                    NightlyDecision::Wait => {
                        counts.waiting += due.len() - index;
                        break 'batches;
                    }
                    NightlyDecision::Drop => NightlyOutcome::Dropped,
                    NightlyDecision::Miss => NightlyOutcome::Missed,
                    NightlyDecision::Retry => NightlyOutcome::Retrying,
                    NightlyDecision::Start => self.start_nightly(&member.user, member.timezone).await,
                };
                counts.add(outcome);
                let next_run = outcome.next_run(&member.user, member.timezone, now);
                if let Err(error) = repo
                    .record_nightly(&member.user, outcome, next_run, now)
                    .await
                {
                    tracing::warn!(
                        ?error,
                        outcome = outcome.as_ref(),
                        "could not record a nightly outcome"
                    );
                }
            }
        }
        let span = tracing::Span::current();
        span.record("suggestion.nightly.started", counts.started);
        span.record("suggestion.nightly.skipped", counts.skipped);
        span.record("suggestion.nightly.dropped", counts.dropped);
        span.record("suggestion.nightly.missed", counts.missed);
        span.record("suggestion.nightly.retrying", counts.retrying);
        span.record("suggestion.nightly.waiting", counts.waiting);
        if counts.missed > 0 || counts.waiting > 0 {
            // Due but not started: nightly capacity is short.
            tracing::warn!(
                event = "suggestion.nightly_short",
                missed = counts.missed,
                waiting = counts.waiting,
                "people due a nightly generation weren't started"
            );
        }
        Ok(counts.started)
    }

    /// Start one person's nightly run with one of this process's nightly
    /// places; what became of them.
    async fn start_nightly(&self, user: &MacroUserIdStr<'static>, timezone: Tz) -> NightlyOutcome {
        let Ok(permit) = Arc::clone(&self.nightly).try_acquire_owned() else {
            // The tick is the only one taking places, and runs only free
            // them; never expected.
            return NightlyOutcome::Retrying;
        };
        match self
            .launch(user, GenerationTrigger::Nightly, timezone, Some(permit))
            .await
        {
            Ok(StartOutcome::Started) => NightlyOutcome::Started,
            // Ran within the window, one of theirs runs, or nothing is on
            // or due: the next night.
            Ok(StartOutcome::Refused(_) | StartOutcome::Nothing)
            | Err(
                GenerationError::NotFound
                | GenerationError::Running
                | GenerationError::Cooldown { .. },
            ) => NightlyOutcome::Skipped,
            Err(GenerationError::Internal(error)) => {
                tracing::warn!(?error, "could not start a nightly generation");
                NightlyOutcome::Retrying
            }
        }
    }

    /// Mark interrupted the generations whose process stopped beating, end
    /// the sessions they left open, and delete the sessions whose delete
    /// failed or never ran. How many generations and sessions it handled.
    #[tracing::instrument(name = "suggestion.sweep", skip_all, fields(
        suggestion.sweep.interrupted = tracing::field::Empty,
        suggestion.sweep.orphaned = tracing::field::Empty,
        suggestion.sweep.stuck = tracing::field::Empty,
        suggestion.sweep.deleted = tracing::field::Empty,
        suggestion.sweep.abandoned = tracing::field::Empty,
        suggestion.changes_pruned = tracing::field::Empty,
    ), err)]
    pub async fn sweep(&self) -> Result<usize, GenerationError> {
        let now = Utc::now();
        let repo = &self.runner.repo;
        let span = tracing::Span::current();
        let lost = repo
            .interrupt_lost(now - HEARTBEAT_LOST, now, SWEEP_BATCH)
            .await
            .map_err(GenerationError::internal)?;
        for generation in &lost {
            tracing::warn!(
                event = "suggestion.generation_interrupted",
                suggestion.generation.id = %generation.generation,
                suggestion.generation.trigger = generation.trigger.as_ref(),
                "a generation's process stopped without ending it"
            );
            // A nightly run cut short is due again at once, for its next
            // attempt.
            if generation.trigger == GenerationTrigger::Nightly
                && let Err(error) = repo
                    .record_nightly(&generation.user, NightlyOutcome::CutShort, Some(now), now)
                    .await
            {
                tracing::warn!(?error, "could not make an interrupted nightly run due again");
            }
        }
        let orphaned = repo
            .end_orphaned_sessions(now - STALE_SESSION, now, SWEEP_BATCH)
            .await
            .map_err(GenerationError::internal)?;
        let stuck = repo
            .claim_stuck_sessions(now - CLEANUP_RETRY, now, SWEEP_BATCH)
            .await
            .map_err(GenerationError::internal)?;
        let (mut deleted, mut abandoned) = (0, 0);
        for session in orphaned.iter().chain(&stuck) {
            match self
                .runner
                .clean_up(&action_for(session), session.ending, session.attempts)
                .await
            {
                Cleanup::Deleted => deleted += 1,
                Cleanup::Abandoned => abandoned += 1,
                Cleanup::Open | Cleanup::Stopping => {}
            }
        }
        // The change log is for us, never shown: kept for a while, then
        // deleted a batch at a time.
        match repo.prune_changes(now - CHANGES_KEPT, PRUNE_BATCH).await {
            Ok(pruned) => {
                span.record("suggestion.changes_pruned", pruned);
            }
            Err(error) => tracing::warn!(?error, "could not prune the suggestion change log"),
        }
        span.record("suggestion.sweep.interrupted", lost.len());
        span.record("suggestion.sweep.orphaned", orphaned.len());
        span.record("suggestion.sweep.stuck", stuck.len());
        span.record("suggestion.sweep.deleted", deleted);
        span.record("suggestion.sweep.abandoned", abandoned);
        Ok(lost.len() + orphaned.len() + stuck.len())
    }

    /// The person loaded the app in zone `timezone`: with suggestions on and a
    /// paid plan, they count as active for nightly runs.
    pub async fn seen(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Tz,
    ) -> Result<(), GenerationError> {
        let (suggestions, _) = self.kinds(user).await;
        if !suggestions || self.plan(user).await != Plan::Paid {
            return Ok(());
        }
        let now = Utc::now();
        self.runner
            .repo
            .see(
                user,
                timezone.name(),
                now,
                night::upcoming(user, timezone, now),
            )
            .await
            .map_err(GenerationError::internal)
    }

    /// The person's routine suggestions: AI's, then Macro's templates.
    pub async fn routine_suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<scheduled_action::domain::suggestions::model::RoutineSuggestions, GenerationError>
    {
        self.runner
            .routines
            .suggestions(user, None)
            .await
            .map_err(|error| GenerationError::Internal(rootcause::report!("{error:?}")))
    }

    /// Wait for every generation running here to stop.
    pub async fn wait(&self) {
        self.tasks.close();
        self.tasks.wait().await;
    }
}

impl<Repo, Sessions, Routines, SuggestionFeed> Runner<Repo, Sessions, Routines, SuggestionFeed>
where
    Repo: GenerationRepo,
    Sessions: RoutineSessions,
    Routines: RoutineSuggestionApi,
    SuggestionFeed: SuggestionApi,
{
    /// The generation: its suggestions session and its routines sessions at
    /// once, beating its heartbeat, then its end.
    async fn run(self: Arc<Self>, run: Run, shutdown: CancellationToken) {
        let span = tracing::Span::current();
        let lost = CancellationToken::new();
        let stop = Stop {
            shutdown: &shutdown,
            lost: &lost,
        };
        let sessions = async {
            let suggestions = async {
                if run.suggestions {
                    Some(self.suggestions_session(&run, stop).await)
                } else {
                    None
                }
            };
            let routines = async {
                if run.routines {
                    self.routine_sessions(&run, stop).await
                } else {
                    Vec::new()
                }
            };
            tokio::join!(suggestions, routines)
        };
        let (suggestions, routines) = tokio::select! {
            ended = sessions => ended,
            never = self.heartbeat(run.generation, &lost) => match never {},
        };
        let ended: Vec<&Ended> = suggestions
            .iter()
            .chain(routines.iter().map(|group| &group.ended))
            .collect();
        let results: Vec<SessionResult> = ended
            .iter()
            .map(|ended| SessionResult {
                finished: ended.ending == SessionEnding::Finished,
                changed: ended.work.any(),
            })
            .collect();
        let event = conclude(&results, shutdown.is_cancelled());
        let outcome = event.entered();
        // The status first: a stopping process may get no further.
        match self.repo.end(run.generation, event, Utc::now()).await {
            Ok(true) => {}
            Ok(false) => tracing::warn!(
                outcome = outcome.as_ref(),
                "a generation had already ended when its sessions did"
            ),
            Err(error) => tracing::error!(?error, "could not record how a generation ended"),
        }
        // What a stopping process deferred, now that the end is stored.
        let deferred = ended.iter().filter_map(|ended| {
            ended
                .deferred
                .as_ref()
                .map(|action| self.clean_up(action, ended.ending, 0))
        });
        futures::future::join_all(deferred).await;
        let now = Utc::now();
        if routines
            .iter()
            .any(|group| routines_ok(group.ended.ending, group.ended.work))
            && let Err(error) = self
                .repo
                .routines_ok(&run.user, run.timezone.name(), now)
                .await
        {
            tracing::warn!(?error, "could not record a week's routine suggestions");
        }
        if run.routines {
            self.report_routines(&run, &routines, &shutdown).await;
        }
        // A nightly run cut short is due again at once, for its next attempt.
        if run.trigger == GenerationTrigger::Nightly
            && event == GenerationEvent::ProcessStopped
            && let Err(error) = self
                .repo
                .record_nightly(&run.user, NightlyOutcome::CutShort, Some(now), now)
                .await
        {
            tracing::warn!(?error, "could not make a cancelled nightly run due again");
        }
        let feed_changes = suggestions.as_ref().map_or(0, |ended| ended.work.count());
        let routines_suggested: u32 = routines.iter().map(|group| group.ended.work.count()).sum();
        let retries = routines.iter().filter(|group| group.retried).count();
        span.record("suggestion.generation.feed_changes", feed_changes);
        span.record("suggestion.generation.routines_suggested", routines_suggested);
        span.record("suggestion.generation.retries", retries);
        span.record("suggestion.generation.outcome", outcome.as_ref());
        if event == GenerationEvent::NoneFinished {
            span.record("otel.status_code", "ERROR");
        }
        tracing::info!(
            event = "suggestion_generation.finished",
            trigger = run.trigger.as_ref(),
            outcome = outcome.as_ref(),
            sessions = ended.len(),
            feed_changes,
            routines_suggested,
            retries,
        );
    }

    /// Tell storage the generation is alive while it runs. If storage no
    /// longer counts it running, its sessions stop.
    async fn heartbeat(&self, generation: Uuid, lost: &CancellationToken) -> Infallible {
        let mut beats =
            tokio::time::interval_at(tokio::time::Instant::now() + HEARTBEAT, HEARTBEAT);
        beats.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            beats.tick().await;
            match self.repo.beat(generation, Utc::now()).await {
                Ok(true) => {}
                Ok(false) => {
                    tracing::warn!("a generation no longer counts as running; its sessions stop");
                    lost.cancel();
                    return std::future::pending().await;
                }
                Err(error) => tracing::warn!(?error, "could not beat a generation's heartbeat"),
            }
        }
    }

    /// Have routine suggestions log what the routines sessions did, as
    /// their dashboard reads it.
    async fn report_routines(
        &self,
        run: &Run,
        routines: &[GroupEnded],
        shutdown: &CancellationToken,
    ) {
        let suggested: u32 = routines.iter().map(|group| group.ended.work.count()).sum();
        let outcome = if shutdown.is_cancelled() && suggested == 0 {
            "cancelled"
        } else if routines.iter().all(|group| group.ended.work.any()) {
            "ready"
        } else if suggested > 0 {
            "partial"
        } else {
            "failed"
        };
        let duration = Utc::now() - run.started_at;
        self.routines
            .record(
                &run.user,
                RoutineGenerationReport {
                    trigger: run.trigger.into(),
                    outcome,
                    sessions: routines.len(),
                    kept: suggested,
                    retries: routines.iter().filter(|group| group.retried).count(),
                    started_at: run.started_at,
                    duration_ms: u64::try_from(duration.num_milliseconds()).unwrap_or(0),
                },
            )
            .await;
    }

    /// The generation's one suggestions session.
    async fn suggestions_session(&self, run: &Run, stop: Stop<'_>) -> Ended {
        let brief = self.suggestions.brief(run.trigger, run.timezone);
        self.session(run, SessionKind::Suggestions, &[], brief, 1, stop)
            .await
    }

    /// At onboarding, one routines session per layout group, and one that
    /// suggested nothing is retried once; otherwise one session for every
    /// surface. Each group's end, and whether it was retried.
    async fn routine_sessions(&self, run: &Run, stop: Stop<'_>) -> Vec<GroupEnded> {
        // Onboarding splits the surfaces so the first suggestions arrive
        // fast; otherwise nobody waits on routines, so one session covers
        // them all at a third of the cost.
        let single = SessionLayout::single();
        let layout = match run.trigger {
            GenerationTrigger::Onboarding => &self.layout,
            GenerationTrigger::Nightly | GenerationTrigger::Manual => &single,
        };
        let groups = layout.sessions().iter().map(|surfaces| async move {
            let first = self.routine_session(run, surfaces, 1, stop).await;
            let retry = run.trigger == GenerationTrigger::Onboarding
                && !first.work.any()
                && !stop.any();
            if retry {
                GroupEnded {
                    ended: self.routine_session(run, surfaces, 2, stop).await,
                    retried: true,
                }
            } else {
                GroupEnded {
                    ended: first,
                    retried: false,
                }
            }
        });
        futures::future::join_all(groups).await
    }

    async fn routine_session(
        &self,
        run: &Run,
        surfaces: &[Surface],
        attempt: u8,
        stop: Stop<'_>,
    ) -> Ended {
        let brief = match self
            .routines
            .brief(&run.user, surfaces, run.trigger, run.timezone)
            .await
        {
            Ok(brief) => brief,
            Err(error) => {
                tracing::warn!(error = ?error, "could not brief a routines session");
                return Ended {
                    ending: SessionEnding::Failed,
                    work: Work::RoutinesSuggested(0),
                    deferred: None,
                };
            }
        };
        let names: Vec<String> = surfaces
            .iter()
            .filter_map(|surface| serde_json::to_value(surface).ok())
            .filter_map(|value| value.as_str().map(str::to_owned))
            .collect();
        self.session(run, SessionKind::Routines, &names, brief, attempt, stop)
            .await
    }

    /// Run one hidden session with `brief` until its turn ends, its kind's
    /// timeout, or a stop; store its ending, count what it did, then stop
    /// and delete it.
    async fn session(
        &self,
        run: &Run,
        kind: SessionKind,
        surfaces: &[String],
        brief: String,
        attempt: u8,
        stop: Stop<'_>,
    ) -> Ended {
        let session = AgentSessionId::new();
        let span = tracing::info_span!(
            "suggestion.session",
            agent.session.id = %session,
            suggestion.session.kind = kind.as_ref(),
            suggestion.session.surfaces = ?surfaces,
            suggestion.session.attempt = attempt,
            suggestion.session.status_reads = tracing::field::Empty,
            suggestion.session.tool_calls = tracing::field::Empty,
            suggestion.session.turns = tracing::field::Empty,
            suggestion.session.ended = tracing::field::Empty,
            suggestion.session.reason = tracing::field::Empty,
            suggestion.session.work = tracing::field::Empty,
            suggestion.session.cleanup = tracing::field::Empty,
        );
        async {
            let span = tracing::Span::current();
            let action = RoutineSessionAction {
                owner: run.user.clone(),
                bot_id: self.agent.bot,
                session_id: session,
                action_id: AgentActionId::mint(),
            };
            if let Err(error) = self
                .repo
                .open_session(
                    session.as_uuid(),
                    run.generation,
                    &run.user,
                    self.agent.bot,
                    kind,
                    surfaces,
                    Utc::now(),
                )
                .await
            {
                tracing::error!(error = ?error, "could not open a generation session");
                span.record("suggestion.session.ended", SessionEnding::Failed.as_ref());
                span.record("suggestion.session.reason", "not_opened");
                return Ended {
                    ending: SessionEnding::Failed,
                    work: nothing(kind),
                    deferred: None,
                };
            }
            let reads = AtomicU32::new(0);
            let (ending, reason) = tokio::select! {
                biased;
                () = stop.shutdown.cancelled() => (SessionEnding::Cancelled, None),
                () = stop.lost.cancelled() => (SessionEnding::Interrupted, Some("heartbeat_lost")),
                turn = tokio::time::timeout(timeout(run.trigger, kind), self.turn(&action, brief, &reads)) => match turn {
                    Ok(Ok(ended)) => ended,
                    Ok(Err(RoutineSessionError::PromptDeliveryUnknown)) => (SessionEnding::DeliveryUnknown, None),
                    Ok(Err(error)) => {
                        tracing::warn!(error = ?error, "a generation session failed");
                        (SessionEnding::Failed, Some("session_error"))
                    }
                    Err(_) => (SessionEnding::TimedOut, None),
                },
            };
            // Each field once: a span keeps a bounded number of attributes.
            span.record("suggestion.session.ended", ending.as_ref());
            if let Some(reason) = reason {
                span.record("suggestion.session.reason", reason);
            }
            span.record("suggestion.session.status_reads", reads.load(Ordering::Relaxed));
            if let Ok(activity) = self.sessions.activity(action.clone()).await {
                span.record("suggestion.session.tool_calls", activity.tool_calls);
                span.record("suggestion.session.turns", activity.turns);
            }
            // The ending first: from here its tools refuse it, so what it
            // changed is final when counted.
            match self.repo.end_session(session.as_uuid(), ending, Utc::now()).await {
                Ok(true) => {}
                Ok(false) => tracing::warn!("a generation session had already ended"),
                Err(error) => {
                    tracing::warn!(?error, "could not record how a generation session ended");
                }
            }
            let work = self.work(run, kind, session.as_uuid()).await;
            span.record("suggestion.session.work", work.count());
            // A stopping process stores its generation's end before
            // cleaning up; the sweep finishes what it doesn't get to.
            if stop.shutdown.is_cancelled() {
                return Ended {
                    ending,
                    work,
                    deferred: Some(action),
                };
            }
            let cleanup = self.clean_up(&action, ending, 0).await;
            span.record("suggestion.session.cleanup", cleanup.as_ref());
            Ended {
                ending,
                work,
                deferred: None,
            }
        }
        .instrument(span)
        .await
    }

    /// What session `session` of kind `kind` did, by its kind's measure;
    /// nothing when it can't be counted.
    async fn work(&self, run: &Run, kind: SessionKind, session: Uuid) -> Work {
        match kind {
            SessionKind::Suggestions => Work::FeedChanges(
                self.suggestions
                    .feed_changes(run.generation, session)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(?error, "could not count a suggestions session's changes");
                    })
                    .unwrap_or(0),
            ),
            SessionKind::Routines => Work::RoutinesSuggested(
                self.routines
                    .suggested(&run.user, session)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(?error, "could not count a routines session's suggestions");
                    })
                    .unwrap_or(0),
            ),
        }
    }

    /// Open the hidden session, prompt it once and wait for its turn to end:
    /// how, with the failure's name.
    async fn turn(
        &self,
        action: &RoutineSessionAction,
        brief: String,
        reads: &AtomicU32,
    ) -> Result<(SessionEnding, Option<&'static str>), RoutineSessionError> {
        self.sessions
            .prepare(PrepareRoutineSession {
                selection: ValidateRoutineSession {
                    owner: action.owner.clone(),
                    bot_id: action.bot_id,
                    model: Some(self.agent.model.clone()),
                    mcp_servers: Vec::new(),
                },
                session_id: action.session_id,
                // A background session of the person's, never a routine's
                // run: hidden, and it notifies nobody.
                source: SessionSource::User,
                visibility: SessionVisibility::Hidden,
                origin: trigger_context::TriggerOrigin::Requested {
                    by: action.owner.clone(),
                },
                // Its turns are metered but never billed.
                billing: SessionBilling::NonBillable,
            })
            .await?;
        self.sessions
            .prompt(PromptRoutineSession {
                action: action.clone(),
                prompt: brief,
                context: None,
            })
            .await?;
        // The session has no completion signal to wait on: read its status,
        // less often the longer it runs.
        let mut delay = FIRST_POLL;
        let mut failures = 0;
        loop {
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(MAX_POLL);
            reads.fetch_add(1, Ordering::Relaxed);
            match self.sessions.status(action.clone()).await {
                Ok(status) => {
                    failures = 0;
                    match poll(&status) {
                        Poll::Ended(ending, reason) => return Ok((ending, reason)),
                        Poll::Waiting => {}
                    }
                }
                Err(error) => {
                    failures += 1;
                    if failures >= MAX_STATUS_FAILURES {
                        return Err(error);
                    }
                }
            }
        }
    }

    /// Stop the session if its turn may still run, delete it, and store how
    /// far that got: deleted (or confirmed missing), or a failed delete for
    /// the sweep to retry, given up after
    /// [`super::session::MAX_CLEANUP_ATTEMPTS`]. `attempts` deletes failed
    /// before.
    async fn clean_up(
        &self,
        action: &RoutineSessionAction,
        ending: SessionEnding,
        attempts: u8,
    ) -> Cleanup {
        // A failed stop doesn't hold up the delete, which stops it too.
        if ending.turn_may_run()
            && let Err(error) = self.sessions.cancel(action.clone()).await
        {
            tracing::warn!(error = ?error, "could not stop a generation session");
        }
        let event = match self.sessions.delete(action.clone()).await {
            Ok(()) => CleanupEvent::Deleted,
            Err(error) => match self.stored(action.session_id).await {
                Some(false) => CleanupEvent::Deleted,
                Some(true) | None => {
                    tracing::warn!(error = ?error, attempts, "could not delete a generation session");
                    CleanupEvent::delete_failed(attempts)
                }
            },
        };
        if event == CleanupEvent::GaveUp {
            tracing::warn!(
                event = "suggestion.session_abandoned",
                agent.session.id = %action.session_id,
                "gave up deleting a generation session"
            );
        }
        match self
            .repo
            .advance_cleanup(action.session_id.as_uuid(), event, Utc::now())
            .await
        {
            Ok(true) => {}
            Ok(false) => tracing::warn!("a generation session's cleanup had moved on"),
            Err(error) => {
                tracing::warn!(?error, "could not record a generation session's cleanup");
            }
        }
        event.entered()
    }

    /// Whether `session` is stored; none when that can't be told.
    async fn stored(&self, session: AgentSessionId) -> Option<bool> {
        let stored = self.stored.as_ref()?;
        stored
            .exists(session)
            .await
            .inspect_err(|error| tracing::warn!(?error, "could not look a session up"))
            .ok()
    }
}

/// What a session of `kind` that never ran did.
fn nothing(kind: SessionKind) -> Work {
    match kind {
        SessionKind::Suggestions => Work::FeedChanges(0),
        SessionKind::Routines => Work::RoutinesSuggested(0),
    }
}

fn action_for(session: &StaleSession) -> RoutineSessionAction {
    RoutineSessionAction {
        owner: session.user.clone(),
        bot_id: session.agent,
        session_id: AgentSessionId::new_from_uuid(session.session),
        action_id: AgentActionId::mint(),
    }
}
