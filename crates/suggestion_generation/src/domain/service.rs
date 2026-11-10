//! Generations: runs of hidden agent sessions that write a person's ideas
//! and routine suggestions.
//!
//! A generation starts at onboarding ([`GenerationService::start`]) or in
//! the person's night ([`GenerationService::nightly`]). It runs one ideas
//! session and the routines sessions of the [`SessionLayout`] at once, each
//! for the person, hidden and non-billable (`SessionBilling::NonBillable`),
//! each told what its kind's crate briefs it with. A session may only call
//! its kind's tools while its row in `suggestion_generation_session` is
//! open; the tools decide and log everything else. Code here only schedules
//! sessions, waits for their turn and cleans up: no reconciling, ranking or
//! retiring.

use std::sync::Arc;
use std::time::Duration;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::{
    AgentSessionId, SessionBilling, SessionSource, SessionVisibility,
};
use agent_session::domain::routines::{
    PrepareRoutineSession, PromptRoutineSession, RoutineActionStatus, RoutineSessionAction,
    RoutineSessionError, RoutineSessions, ValidateRoutineSession,
};
use chrono::Utc;
use chrono_tz::Tz;
use feature_flags::FeatureFlags;
use ideas::domain::model::{GenerationTrigger, SessionKind};
use ideas::domain::ports::IdeaApi;
use ideas::domain::service::IDEAS_FLAG;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use scheduled_action::domain::suggestions::ROUTINE_SUGGESTIONS_FLAG;
use scheduled_action::domain::suggestions::model::RoutineGenerationReport;
use scheduled_action::domain::suggestions::ports::RoutineSuggestionApi;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::model::{
    AudienceMember, GenerationAgent, GenerationError, GenerationOutcome, SessionLayout,
    StaleSession,
};
use super::ports::{GenerationRepo, Plans};

#[cfg(test)]
mod test;

/// The longest an onboarding routines session runs: the person is waiting.
pub const ONBOARDING_ROUTINES_TIMEOUT: Duration = Duration::from_secs(240);
/// The longest a nightly routines session runs: it reviews what it suggested
/// before, too.
pub const NIGHTLY_ROUTINES_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The longest an onboarding ideas session runs: the person is waiting.
pub const ONBOARDING_IDEAS_TIMEOUT: Duration = Duration::from_secs(240);
/// The longest a nightly ideas session runs: it researches the whole
/// workspace.
pub const NIGHTLY_IDEAS_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How long a session row may stay open before the sweep deletes it and
/// its session: longer than any session.
pub const STALE_SESSION: Duration = Duration::from_secs(20 * 60);
/// How long a generation may stay running before it counts as interrupted
/// and may start again: longer than its sessions and a retry.
pub const STALE_GENERATION: Duration = Duration::from_secs(25 * 60);
/// Who counts as active for a nightly run: seen in the last week.
pub const ACTIVE_WITHIN: chrono::TimeDelta = chrono::TimeDelta::days(7);
/// The local hours a nightly run starts in: 2 to 5 am.
pub const NIGHT: (u8, u8) = (2, 5);
/// Nightly runs at most once in this long, whatever the zone does.
pub const NIGHTLY_EVERY: chrono::TimeDelta = chrono::TimeDelta::hours(20);
/// How often a person's nightly run includes a routines session: once a
/// week. Other nights run only the ideas session.
pub const ROUTINES_EVERY: chrono::TimeDelta = chrono::TimeDelta::days(7);
/// Nightly generations one process runs at once.
pub const MAX_NIGHTLY_RUNS: usize = 2;
const SWEEP_BATCH: u16 = 64;
const FIRST_POLL: Duration = Duration::from_millis(500);
const MAX_POLL: Duration = Duration::from_secs(2);
const MAX_STATUS_FAILURES: u8 = 5;

/// Starts and runs generations.
pub struct GenerationService<Repo, Sessions, Routines, Ideas, Flags> {
    runner: Arc<Runner<Repo, Sessions, Routines, Ideas>>,
    flags: Option<Flags>,
    /// Who is on a paid plan; without it, nobody gets a nightly run.
    plans: Option<Arc<dyn Plans>>,
    nightly: Arc<Semaphore>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

/// What a generation needs, shared with its background task.
struct Runner<Repo, Sessions, Routines, Ideas> {
    repo: Arc<Repo>,
    sessions: Arc<Sessions>,
    routines: Arc<Routines>,
    ideas: Arc<Ideas>,
    agent: GenerationAgent,
    layout: SessionLayout,
}

/// One generation, as it runs.
struct Run {
    generation: Uuid,
    started_at: chrono::DateTime<Utc>,
    user: MacroUserIdStr<'static>,
    trigger: GenerationTrigger,
    timezone: Tz,
    ideas: bool,
    routines: bool,
}

/// How one session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Ending {
    Finished,
    TimedOut,
    /// The prompt may or may not have reached the session; it is stopped.
    DeliveryUnknown,
    Failed,
    Cancelled,
}

/// One session's end and what it kept.
#[derive(Debug, Clone, Copy)]
struct Ended {
    ending: Ending,
    kept: u32,
}

impl<Repo, Sessions, Routines, Ideas, Flags>
    GenerationService<Repo, Sessions, Routines, Ideas, Flags>
where
    Repo: GenerationRepo,
    Sessions: RoutineSessions,
    Routines: RoutineSuggestionApi,
    Ideas: IdeaApi,
    Flags: FeatureFlags + 'static,
{
    /// Generations run on `tasks` and stop at `shutdown`. Without `flags`
    /// nothing generates.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        repo: Arc<Repo>,
        sessions: Arc<Sessions>,
        routines: Arc<Routines>,
        ideas: Arc<Ideas>,
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
                ideas,
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

    /// Whether the person is on a paid plan; no when it can't be told.
    async fn paid(&self, user: &MacroUserIdStr<'static>) -> bool {
        let Some(plans) = &self.plans else {
            return false;
        };
        plans
            .paid(user)
            .await
            .inspect_err(|error| tracing::warn!(?error, "could not read a plan; no nightly run"))
            .unwrap_or(false)
    }

    /// Split routine suggestions across `layout`'s sessions.
    pub fn with_layout(mut self, layout: SessionLayout) -> Self {
        if let Some(runner) = Arc::get_mut(&mut self.runner) {
            runner.layout = layout;
        }
        self
    }

    /// Which kinds are on for the person: ideas, routine suggestions.
    async fn kinds(&self, user: &MacroUserIdStr<'_>) -> (bool, bool) {
        let Some(flags) = &self.flags else {
            return (false, false);
        };
        match flags.load(user).await {
            Ok(flags) => (
                flags.is_enabled(IDEAS_FLAG),
                flags.is_enabled(ROUTINE_SUGGESTIONS_FLAG),
            ),
            Err(error) => {
                tracing::warn!(?error, "feature flags unavailable; nothing generates");
                (false, false)
            }
        }
    }

    /// Start the person's generation for `trigger` in the background, if
    /// one may start: their onboarding one runs once, a nightly one once a
    /// night. Off when neither ideas nor routine suggestions are on.
    #[tracing::instrument(name = "suggestion.generation.start", skip_all, fields(
        suggestion.generation.trigger = trigger.as_ref(),
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.ideas = tracing::field::Empty,
        suggestion.generation.routines = tracing::field::Empty,
    ), err)]
    pub async fn start(
        &self,
        user: &MacroUserIdStr<'static>,
        trigger: GenerationTrigger,
        timezone: Tz,
    ) -> Result<bool, GenerationError> {
        let (ideas, mut routines) = self.kinds(user).await;
        if !ideas && !routines {
            return Err(GenerationError::NotFound);
        }
        let now = Utc::now();
        let repo = &self.runner.repo;
        // Routine suggestions come once a week; other nights only ideas.
        if trigger == GenerationTrigger::Nightly
            && routines
            && repo
                .routines_since(user, now - ROUTINES_EVERY)
                .await
                .map_err(GenerationError::internal)?
        {
            routines = false;
        }
        let span = tracing::Span::current();
        span.record("suggestion.generation.ideas", ideas);
        span.record("suggestion.generation.routines", routines);
        if !ideas && !routines {
            return Ok(false);
        }
        if trigger == GenerationTrigger::Onboarding && self.paid(user).await {
            repo.see(user, timezone.name(), now)
                .await
                .map_err(GenerationError::internal)?;
        }
        let stale =
            chrono::Duration::from_std(STALE_GENERATION).map_err(GenerationError::internal)?;
        let Some(generation) = repo
            .begin(user, trigger, now, now - stale, now - NIGHTLY_EVERY)
            .await
            .map_err(GenerationError::internal)?
        else {
            return Ok(false);
        };
        span.record("suggestion.generation.id", generation.to_string());
        let run = Run {
            generation,
            started_at: now,
            user: user.clone(),
            trigger,
            timezone,
            ideas,
            routines,
        };
        // A child of the starting span, so a start and its run stay one
        // trace.
        let run_span = tracing::info_span!(
            "suggestion.generation",
            suggestion.generation.id = %generation,
            suggestion.generation.trigger = trigger.as_ref(),
            suggestion.generation.ideas = ideas,
            suggestion.generation.routines = routines,
            suggestion.generation.ideas_kept = tracing::field::Empty,
            suggestion.generation.routines_kept = tracing::field::Empty,
            suggestion.generation.retries = tracing::field::Empty,
            suggestion.generation.outcome = tracing::field::Empty,
        );
        let runner = Arc::clone(&self.runner);
        let shutdown = self.shutdown.clone();
        let permit = match trigger {
            GenerationTrigger::Onboarding => None,
            GenerationTrigger::Nightly => Arc::clone(&self.nightly).try_acquire_owned().ok(),
        };
        self.tasks.spawn(
            async move {
                runner.run(run, shutdown).await;
                drop(permit);
            }
            .instrument(run_span),
        );
        Ok(true)
    }

    /// Start nightly generations for the people due one, as many as this
    /// process has room for. How many started.
    #[tracing::instrument(name = "suggestion.nightly", skip_all, fields(
        suggestion.nightly.due = tracing::field::Empty,
        suggestion.nightly.started = tracing::field::Empty,
    ), err)]
    pub async fn nightly(&self) -> Result<usize, GenerationError> {
        let room = self.nightly.available_permits();
        if room == 0 {
            return Ok(0);
        }
        let now = Utc::now();
        let stale =
            chrono::Duration::from_std(STALE_GENERATION).map_err(GenerationError::internal)?;
        let due: Vec<AudienceMember> = self
            .runner
            .repo
            .due(
                now,
                now - ACTIVE_WITHIN,
                now - NIGHTLY_EVERY,
                now - stale,
                NIGHT,
                u16::try_from(room).unwrap_or(u16::MAX),
            )
            .await
            .map_err(GenerationError::internal)?;
        let span = tracing::Span::current();
        span.record("suggestion.nightly.due", due.len());
        let mut started = 0;
        for member in due {
            // Nightly runs are for paid plans; the rest wait to be seen
            // again on one.
            if !self.paid(&member.user).await {
                if let Err(error) = self.runner.repo.forget(&member.user).await {
                    tracing::warn!(?error, "could not drop an unpaid person from the audience");
                }
                continue;
            }
            match self
                .start(&member.user, GenerationTrigger::Nightly, member.timezone)
                .await
            {
                Ok(true) => started += 1,
                Ok(false) | Err(GenerationError::NotFound) => {}
                Err(error) => tracing::warn!(?error, "could not start a nightly generation"),
            }
        }
        span.record("suggestion.nightly.started", started);
        Ok(started)
    }

    /// Delete the sessions and close the rows a process that stopped
    /// mid-generation left behind. How many it cleaned up.
    #[tracing::instrument(name = "suggestion.sweep", skip_all, fields(
        suggestion.swept = tracing::field::Empty,
    ), err)]
    pub async fn sweep(&self) -> Result<usize, GenerationError> {
        let stale = chrono::Duration::from_std(STALE_SESSION).map_err(GenerationError::internal)?;
        let stale = self
            .runner
            .repo
            .stale_sessions(Utc::now() - stale, SWEEP_BATCH)
            .await
            .map_err(GenerationError::internal)?;
        for session in &stale {
            self.runner.clean_up(&action_for(session), false).await;
        }
        tracing::Span::current().record("suggestion.swept", stale.len());
        Ok(stale.len())
    }

    /// The person loaded the app in zone `timezone`: with ideas on and a
    /// paid plan, they count as active for nightly runs.
    pub async fn seen(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Tz,
    ) -> Result<(), GenerationError> {
        let (ideas, _) = self.kinds(user).await;
        if !ideas || !self.paid(user).await {
            return Ok(());
        }
        self.runner
            .repo
            .see(user, timezone.name(), Utc::now())
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

impl<Repo, Sessions, Routines, Ideas> Runner<Repo, Sessions, Routines, Ideas>
where
    Repo: GenerationRepo,
    Sessions: RoutineSessions,
    Routines: RoutineSuggestionApi,
    Ideas: IdeaApi,
{
    /// The generation: its ideas session and its routines sessions at once.
    async fn run(self: Arc<Self>, run: Run, shutdown: CancellationToken) {
        let span = tracing::Span::current();
        let ideas = async {
            if run.ideas {
                Some(self.ideas_session(&run, &shutdown).await)
            } else {
                None
            }
        };
        let routines = async {
            if run.routines {
                self.routine_sessions(&run, &shutdown).await
            } else {
                Vec::new()
            }
        };
        let (ideas, routines) = tokio::join!(ideas, routines);
        let retries = routines.iter().filter(|(_, retried)| *retried).count();
        let ended: Vec<Ended> = ideas
            .into_iter()
            .chain(routines.iter().map(|(ended, _)| *ended))
            .collect();
        let finished = ended
            .iter()
            .filter(|ended| ended.ending == Ending::Finished)
            .count();
        let outcome = if shutdown.is_cancelled() && finished == 0 {
            GenerationOutcome::Cancelled
        } else if finished == ended.len() {
            GenerationOutcome::Ready
        } else if finished > 0 {
            GenerationOutcome::Partial
        } else {
            GenerationOutcome::Failed
        };
        let ideas_kept = ideas.map_or(0, |ended| ended.kept);
        let routines_kept: u32 = routines.iter().map(|(ended, _)| ended.kept).sum();
        if run.routines {
            self.report_routines(&run, &routines, &shutdown).await;
        }
        if outcome != GenerationOutcome::Cancelled
            && let Err(error) = self
                .repo
                .finish(run.generation, finished > 0, Utc::now())
                .await
        {
            tracing::error!(error = ?error, "could not record how a generation ended");
        }
        span.record("suggestion.generation.ideas_kept", ideas_kept);
        span.record("suggestion.generation.routines_kept", routines_kept);
        span.record("suggestion.generation.retries", retries);
        span.record("suggestion.generation.outcome", outcome.as_ref());
        tracing::info!(
            event = "suggestion_generation.finished",
            trigger = run.trigger.as_ref(),
            outcome = outcome.as_ref(),
            sessions = ended.len(),
            ideas_kept,
            routines_kept,
            retries,
        );
    }

    /// Have routine suggestions log what the routines sessions did, as
    /// their dashboard reads it.
    async fn report_routines(
        &self,
        run: &Run,
        routines: &[(Ended, bool)],
        shutdown: &CancellationToken,
    ) {
        let kept: u32 = routines.iter().map(|(ended, _)| ended.kept).sum();
        let outcome = if shutdown.is_cancelled() && kept == 0 {
            "cancelled"
        } else if routines.iter().all(|(ended, _)| ended.kept > 0) {
            "ready"
        } else if kept > 0 {
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
                    kept,
                    retries: routines.iter().filter(|(_, retried)| *retried).count(),
                    started_at: run.started_at,
                    duration_ms: u64::try_from(duration.num_milliseconds()).unwrap_or(0),
                },
            )
            .await;
    }

    /// The generation's one ideas session.
    async fn ideas_session(&self, run: &Run, shutdown: &CancellationToken) -> Ended {
        let brief = self.ideas.brief(run.trigger, run.timezone);
        let timeout = match run.trigger {
            GenerationTrigger::Onboarding => ONBOARDING_IDEAS_TIMEOUT,
            GenerationTrigger::Nightly => NIGHTLY_IDEAS_TIMEOUT,
        };
        let session = AgentSessionId::new();
        let ending = self
            .session(
                run,
                session,
                SessionKind::Ideas,
                &[],
                brief,
                timeout,
                1,
                shutdown,
            )
            .await;
        let kept = self
            .ideas
            .kept(session.as_uuid())
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "could not count an ideas session's changes")
            })
            .unwrap_or(0);
        Ended { ending, kept }
    }

    /// At onboarding, one routines session per layout group, and one that
    /// kept nothing is retried once; at night, one session for every
    /// surface. Each session's end, and whether it was
    /// retried.
    async fn routine_sessions(
        &self,
        run: &Run,
        shutdown: &CancellationToken,
    ) -> Vec<(Ended, bool)> {
        // Onboarding splits the surfaces so the first suggestions arrive
        // fast; at night nobody waits, so one session covers them all at a
        // third of the cost.
        let nightly = SessionLayout::single();
        let layout = match run.trigger {
            GenerationTrigger::Onboarding => &self.layout,
            GenerationTrigger::Nightly => &nightly,
        };
        let groups = layout.sessions().iter().map(|surfaces| async move {
            let first = self.routine_session(run, surfaces, 1, shutdown).await;
            let retry = run.trigger == GenerationTrigger::Onboarding
                && first.kept == 0
                && !shutdown.is_cancelled();
            if retry {
                (self.routine_session(run, surfaces, 2, shutdown).await, true)
            } else {
                (first, false)
            }
        });
        futures::future::join_all(groups).await
    }

    async fn routine_session(
        &self,
        run: &Run,
        surfaces: &[Surface],
        attempt: u8,
        shutdown: &CancellationToken,
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
                    ending: Ending::Failed,
                    kept: 0,
                };
            }
        };
        let names: Vec<String> = surfaces
            .iter()
            .filter_map(|surface| serde_json::to_value(surface).ok())
            .filter_map(|value| value.as_str().map(str::to_owned))
            .collect();
        let session = AgentSessionId::new();
        let ending = self
            .session(
                run,
                session,
                SessionKind::Routines,
                &names,
                brief,
                match run.trigger {
                    GenerationTrigger::Onboarding => ONBOARDING_ROUTINES_TIMEOUT,
                    GenerationTrigger::Nightly => NIGHTLY_ROUTINES_TIMEOUT,
                },
                attempt,
                shutdown,
            )
            .await;
        let kept = self
            .routines
            .kept(session.as_uuid())
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "could not count a routines session's suggestions"))
            .unwrap_or(0);
        Ended { ending, kept }
    }

    /// Run one hidden session with `brief` until its turn ends or
    /// `timeout`, then stop and delete it.
    #[expect(clippy::too_many_arguments, reason = "one session, all of its parts")]
    async fn session(
        &self,
        run: &Run,
        session: AgentSessionId,
        kind: SessionKind,
        surfaces: &[String],
        brief: String,
        timeout: Duration,
        attempt: u8,
        shutdown: &CancellationToken,
    ) -> Ending {
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
        );
        async {
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
                return Ending::Failed;
            }
            let ending = tokio::select! {
                ending = tokio::time::timeout(timeout, self.turn(&action, brief)) => match ending {
                    Ok(Ok(ending)) => ending,
                    Ok(Err(RoutineSessionError::PromptDeliveryUnknown)) => Ending::DeliveryUnknown,
                    Ok(Err(error)) => {
                        tracing::warn!(error = ?error, "a generation session failed");
                        Ending::Failed
                    }
                    Err(_) => Ending::TimedOut,
                },
                () = shutdown.cancelled() => Ending::Cancelled,
            };
            let span = tracing::Span::current();
            span.record("suggestion.session.ended", ending.as_ref());
            if let Ok(activity) = self.sessions.activity(action.clone()).await {
                span.record("suggestion.session.tool_calls", activity.tool_calls);
                span.record("suggestion.session.turns", activity.turns);
            }
            self.clean_up(&action, ending == Ending::Finished).await;
            ending
        }
        .instrument(span)
        .await
    }

    /// Open the hidden session, prompt it once and wait for its turn to end.
    async fn turn(
        &self,
        action: &RoutineSessionAction,
        brief: String,
    ) -> Result<Ending, RoutineSessionError> {
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
        let span = tracing::Span::current();
        let mut delay = FIRST_POLL;
        let mut failures = 0;
        let mut reads = 0_u32;
        loop {
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(MAX_POLL);
            reads += 1;
            span.record("suggestion.session.status_reads", reads);
            match self.sessions.status(action.clone()).await {
                Ok(RoutineActionStatus::Succeeded | RoutineActionStatus::Failed(_)) => {
                    return Ok(Ending::Finished);
                }
                Ok(RoutineActionStatus::Pending(_)) => failures = 0,
                Err(error) => {
                    failures += 1;
                    if failures >= MAX_STATUS_FAILURES {
                        return Err(error);
                    }
                }
            }
        }
    }

    async fn stop(&self, action: &RoutineSessionAction) -> bool {
        self.sessions
            .cancel(action.clone())
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not stop a generation session");
            })
            .is_ok()
    }

    /// Stop the session unless it was `stopped`, delete it and close its
    /// row. Each part is tried whatever became of the one before; the sweep
    /// catches what fails.
    async fn clean_up(&self, action: &RoutineSessionAction, stopped: bool) {
        if !stopped {
            self.stop(action).await;
        }
        if let Err(error) = self.sessions.delete(action.clone()).await {
            tracing::warn!(error = ?error, "could not delete a generation session");
        }
        if let Err(error) = self.repo.close_session(action.session_id.as_uuid()).await {
            tracing::warn!(error = ?error, "could not close a generation session");
        }
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
