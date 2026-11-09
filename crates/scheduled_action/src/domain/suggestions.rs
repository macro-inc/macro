//! Routine suggestions: routines AI suggests for one person once their
//! inbox is connected, and Macro's catalog routines filling in.
//!
//! Generation runs once per person, when their inbox connects
//! ([`RoutineSuggestionApi::generate`]): hidden background agent sessions of
//! the in-process Macro agent, as the person, following the Draft pattern
//! (`drafts.rs`), except that their turns are admitted and metered as the
//! non-billable `RoutineSuggestions`, not billed as agent session usage.
//! Each session suggests for some of the surfaces ([`SuggestionLayout`]),
//! reading the person's newest mail and connected
//! apps as untrusted data, and hands back each suggestion as it has it
//! through `macro.routines.suggest` ([`RoutineSuggestionApi::suggest`]),
//! which only the person's own open suggestion sessions may call. A
//! suggestion is a catalog routine with bounded knob values, or a routine
//! the session drafted that passes saving's checks; [`decode`] is the
//! boundary. A session that suggests nothing is retried once; after that
//! Macro's templates fill in. Reads never generate.
//!
//! A read serves, per surface, AI's suggestions best first, then catalog
//! routines marked `suggest` as Macro's templates, to [`PER_SURFACE`],
//! skipping what the person dismissed or saved a routine from. Dismissal is
//! permanent and the next generation is told.

pub mod decode;
pub mod model;
pub mod ports;
pub mod prompt;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::{
    AgentSessionId, SessionMetering, SessionSource, SessionVisibility,
};
use agent_session::domain::routines::{
    PrepareRoutineSession, PromptRoutineSession, RoutineActionStatus, RoutineSessionAction,
    RoutineSessionError, RoutineSessions, ValidateRoutineSession,
};
use anyhow::{Result, bail};
use bot_id::BotId;
use chrono::Utc;
use chrono_tz::Tz;
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::CreationPrincipal;
use routine_program::{CATALOG, Surface};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use self::model::{
    GenerationOutcome, GenerationStatus, RoutineSuggestion, RoutineSuggestions, StoredPick,
    StoredSuggestion, SuggestOutcome, SuggestRequest, SuggestedPick, SuggestionFrom,
};
use self::ports::{SuggestionRepo, SuggestionSession, SuggestionSources};
use super::models::ActionPolicyError;
use super::ports::{RequestSessions, RoutineCode, ScheduledActionService};

#[cfg(test)]
mod test;

/// The PostHog flag that turns routine suggestions on for a person.
pub const ROUTINE_SUGGESTIONS_FLAG: &str = "enable-routine-suggestions";
/// The PostHog flag that lets a person save code steps.
pub const ROUTINE_CODE_STEPS_FLAG: &str = "enable-routine-code-steps";
/// Inbox messages a generation reads.
pub const INBOX_MESSAGES: u16 = 100;
/// Suggestions shown per surface: AI's, then Macro's templates.
pub const PER_SURFACE: usize = 3;
/// AI's catalog picks onboarding shows switched on, at most.
pub const MAX_ON_BY_DEFAULT: usize = 2;
/// The keep estimate a catalog pick needs to be shown switched on.
pub const ON_BY_DEFAULT_KEEP: f32 = 0.6;
/// Suggestions one session may keep.
pub const MAX_KEPT_PER_SESSION: u32 = 12;
/// The longest a session runs.
pub const SESSION_TIMEOUT: Duration = Duration::from_secs(90);
/// How long a session row may stay before the sweep deletes it and its
/// session.
pub const STALE_SESSION: Duration = Duration::from_secs(10 * 60);
const SWEEP_BATCH: u16 = 64;
const FIRST_POLL: Duration = Duration::from_millis(500);
const MAX_POLL: Duration = Duration::from_secs(2);
const MAX_STATUS_FAILURES: u8 = 5;
/// Names Macro's templates' ids, per person and catalog key.
const TEMPLATE_NAMESPACE: Uuid = Uuid::from_u128(0x7c1f_0b5e_3d2a_4e9b_9a41_5f6c_2d8e_a017);

/// The agent that suggests, and the model its sessions run on.
#[derive(Debug, Clone)]
pub struct SuggestionAgent {
    /// The in-process Macro agent.
    pub bot: BotId,
    /// The SDK's routines guide, as drafts read it.
    pub guide: &'static str,
    /// The model suggestion sessions and the Ask AI steps they write run on.
    pub model: String,
}

/// How a generation splits the surfaces across its parallel sessions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuggestionLayout {
    sessions: Vec<Vec<Surface>>,
}

/// Most sessions one generation runs at once.
pub const MAX_SESSIONS: usize = 3;

impl SuggestionLayout {
    /// `sessions` parallel sessions, each with its surfaces: at most
    /// [`MAX_SESSIONS`], each surface in exactly one.
    pub fn new(sessions: Vec<Vec<Surface>>) -> Result<Self> {
        let mut seen = HashSet::new();
        if sessions.is_empty() || sessions.len() > MAX_SESSIONS {
            bail!("a suggestion layout has 1 to {MAX_SESSIONS} sessions");
        }
        for surface in sessions.iter().flatten() {
            if !seen.insert(*surface) {
                bail!("a surface is in two suggestion sessions");
            }
        }
        if sessions.iter().any(Vec::is_empty) || seen.len() != ALL_SURFACES.len() {
            bail!("every surface is in one suggestion session, and no session is empty");
        }
        Ok(Self { sessions })
    }

    /// One session for every surface.
    pub fn single() -> Self {
        Self {
            sessions: vec![ALL_SURFACES.to_vec()],
        }
    }

    pub fn sessions(&self) -> &[Vec<Surface>] {
        &self.sessions
    }
}

impl Default for SuggestionLayout {
    /// Three sessions, the busiest surfaces first in each, so the first
    /// suggestions arrive soon.
    fn default() -> Self {
        Self {
            sessions: vec![
                vec![Surface::Email, Surface::Crm, Surface::Agents],
                vec![Surface::Tasks, Surface::Calls, Surface::Reviews],
                vec![Surface::Calendar, Surface::Chat, Surface::Files],
            ],
        }
    }
}

const ALL_SURFACES: [Surface; 9] = [
    Surface::Email,
    Surface::Calendar,
    Surface::Tasks,
    Surface::Files,
    Surface::Crm,
    Surface::Chat,
    Surface::Calls,
    Surface::Reviews,
    Surface::Agents,
];

/// The id of catalog routine `key` as Macro's template for `user`: the
/// same on every read, so it can be dismissed and saved from.
pub fn template_id(user: &MacroUserIdStr<'_>, key: &str) -> Uuid {
    Uuid::new_v5(
        &TEMPLATE_NAMESPACE,
        format!("{}\n{key}", user.as_ref()).as_bytes(),
    )
}

/// Suggests routines in hidden sessions and serves them.
pub struct RoutineSuggestionService<Actions, Repo, Sources, Sessions, Code, Flags> {
    inner: Arc<Generator<Actions, Repo, Sources, Sessions, Code>>,
    request_sessions: Arc<dyn RequestSessions>,
    flags: Option<Flags>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
}

/// What a generation needs, shared with its background task.
struct Generator<Actions, Repo, Sources, Sessions, Code> {
    actions: Arc<Actions>,
    repo: Arc<Repo>,
    sources: Arc<Sources>,
    sessions: Arc<Sessions>,
    code: Arc<Code>,
    agent: SuggestionAgent,
    layout: SuggestionLayout,
}

/// What a generation is run with.
struct Run {
    user: MacroUserIdStr<'static>,
    timezone: Tz,
    code: bool,
}

/// How one session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum Ending {
    Finished,
    TimedOut,
    Failed,
    Cancelled,
}

impl<Actions, Repo, Sources, Sessions, Code, Flags>
    RoutineSuggestionService<Actions, Repo, Sources, Sessions, Code, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Sessions: RoutineSessions,
    Code: RoutineCode,
    Flags: FeatureFlags + 'static,
{
    /// Generations run on `tasks` and stop at `shutdown`. Without `flags`
    /// suggestions are off for everyone.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        actions: Arc<Actions>,
        repo: Arc<Repo>,
        sources: Arc<Sources>,
        sessions: Arc<Sessions>,
        code: Arc<Code>,
        request_sessions: Arc<dyn RequestSessions>,
        flags: Option<Flags>,
        agent: SuggestionAgent,
        tasks: TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        Self {
            inner: Arc::new(Generator {
                actions,
                repo,
                sources,
                sessions,
                code,
                agent,
                layout: SuggestionLayout::default(),
            }),
            request_sessions,
            flags,
            tasks,
            shutdown,
        }
    }

    /// Split generations across `layout`'s sessions.
    pub fn with_layout(mut self, layout: SuggestionLayout) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.layout = layout;
        }
        self
    }

    /// The flags for the person; none when they can't be read.
    async fn flags(&self, user: &MacroUserIdStr<'_>) -> Option<feature_flags::FlagSnapshot> {
        self.flags
            .as_ref()?
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    ?error,
                    "feature flags unavailable; routine suggestions stay off"
                );
            })
            .ok()
    }

    #[tracing::instrument(name = "routine.suggestions_flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<feature_flags::FlagSnapshot> {
        match self.flags(user).await {
            Some(flags) if flags.is_enabled(ROUTINE_SUGGESTIONS_FLAG) => Ok(flags),
            _ => bail!(ActionPolicyError::NotFound),
        }
    }

    /// Delete the sessions and rows left behind by a process that stopped
    /// mid-generation. How many it cleaned up.
    #[tracing::instrument(name = "routine.suggestions.sweep", skip_all, fields(
        routine.suggestions.swept = tracing::field::Empty,
    ), err)]
    pub async fn sweep(&self) -> Result<usize> {
        let before = Utc::now() - chrono::Duration::from_std(STALE_SESSION)?;
        let stale = self.inner.repo.stale_sessions(before, SWEEP_BATCH).await?;
        for session in &stale {
            self.inner.clean_up(&action_for(session), false).await;
        }
        tracing::Span::current().record("routine.suggestions.swept", stale.len());
        Ok(stale.len())
    }

    /// Wait for every generation running here to stop.
    pub async fn wait(&self) {
        self.tasks.close();
        self.tasks.wait().await;
    }
}

impl<Actions, Repo, Sources, Sessions, Code, Flags> ports::RoutineSuggestionApi
    for RoutineSuggestionService<Actions, Repo, Sources, Sessions, Code, Flags>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Sessions: RoutineSessions,
    Code: RoutineCode,
    Flags: FeatureFlags + 'static,
{
    async fn suggestions(
        &self,
        user: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> Result<RoutineSuggestions> {
        self.require_flag(user).await?;
        self.inner.answer(user, surface).await
    }

    #[tracing::instrument(name = "routine.suggestions.start", skip_all, fields(
        routine.suggestions.started = tracing::field::Empty,
    ), err)]
    async fn generate(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Tz,
    ) -> Result<RoutineSuggestions> {
        let flags = self.require_flag(user).await?;
        let started = self.inner.repo.begin(user, Utc::now()).await?;
        tracing::Span::current().record("routine.suggestions.started", started);
        if started {
            let run = Run {
                user: user.clone(),
                timezone,
                code: self.inner.code.sdk().is_some() && flags.is_enabled(ROUTINE_CODE_STEPS_FLAG),
            };
            // A child of the request's span, so the start and the
            // generation stay one trace.
            let span = tracing::info_span!(
                "routine.suggestions.generate",
                routine.suggestions.sessions = self.inner.layout.sessions().len(),
                routine.suggestions.code = run.code,
                routine.suggestions.inbox_messages = tracing::field::Empty,
                routine.suggestions.apps = tracing::field::Empty,
                routine.suggestions.kept = tracing::field::Empty,
                routine.suggestions.retries = tracing::field::Empty,
                routine.suggestions.first_ms = tracing::field::Empty,
                routine.suggestions.outcome = tracing::field::Empty,
            );
            let inner = Arc::clone(&self.inner);
            let shutdown = self.shutdown.clone();
            self.tasks
                .spawn(async move { inner.generate(run, shutdown).await }.instrument(span));
        }
        self.inner.answer(user, None).await
    }

    #[tracing::instrument(name = "routine.suggestions.dismiss", skip_all, fields(
        routine.suggestion.id = %id,
        routine.suggestion.from = tracing::field::Empty,
    ), err)]
    async fn dismiss(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        self.require_flag(user).await?;
        let span = tracing::Span::current();
        if self.inner.repo.dismiss(user, id).await? {
            span.record("routine.suggestion.from", SuggestionFrom::ForYou.as_ref());
            tracing::info!(event = "routine_suggestions.dismissed", from = "for_you");
            return Ok(());
        }
        let Some(routine) = CATALOG
            .iter()
            .find(|routine| template_id(user, routine.key) == id)
        else {
            bail!(ActionPolicyError::NotFound);
        };
        self.inner.repo.dismiss_template(user, routine.key).await?;
        span.record("routine.suggestion.from", SuggestionFrom::Macro.as_ref());
        tracing::info!(event = "routine_suggestions.dismissed", from = "macro");
        Ok(())
    }

    #[tracing::instrument(name = "routine.suggestions.suggest", skip_all, fields(
        routine.suggestion.kind = request.kind_name(),
        agent.session.id = tracing::field::Empty,
        routine.suggestion.ok = tracing::field::Empty,
        routine.suggestion.problems = tracing::field::Empty,
        routine.suggestion.id = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestRequest,
    ) -> Result<SuggestOutcome> {
        let span = tracing::Span::current();
        let user = principal
            .owner()
            .as_user()
            .ok_or(ActionPolicyError::NotSuggesting)?
            .clone();
        let session = match correlation {
            Some(correlation) => self.request_sessions.session_of(correlation).await?,
            None => None,
        };
        let session = match session {
            Some(session) => self.inner.repo.session(session).await?,
            None => None,
        };
        let Some(session) = session.filter(|session| session.owner == user) else {
            bail!(ActionPolicyError::NotSuggesting);
        };
        span.record("agent.session.id", session.session.to_string());
        let kind = request.kind_name();
        let outcome = self
            .inner
            .suggest(principal, &user, &session, request)
            .await?;
        span.record("routine.suggestion.ok", outcome.ok);
        span.record("routine.suggestion.problems", outcome.problems.len());
        if let Some(id) = outcome.id {
            span.record("routine.suggestion.id", id.to_string());
        }
        tracing::info!(
            event = "routine_suggestions.suggested",
            kind,
            ok = outcome.ok,
            problems = outcome.problems.len(),
        );
        Ok(outcome)
    }
}

impl<Actions, Repo, Sources, Sessions, Code> Generator<Actions, Repo, Sources, Sessions, Code>
where
    Actions: ScheduledActionService,
    Repo: SuggestionRepo,
    Sources: SuggestionSources,
    Sessions: RoutineSessions,
    Code: RoutineCode,
{
    /// The person's suggestions, per surface AI's then Macro's templates.
    async fn answer(
        &self,
        user: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> Result<RoutineSuggestions> {
        let (generation, stored, dismissed_templates, saved_from) = tokio::try_join!(
            self.repo.generation(user),
            self.repo.suggestions(user),
            self.repo.dismissed_templates(user),
            self.repo.saved_from(user),
        )?;
        let status = generation.map_or(GenerationStatus::None, |generation| generation.status);
        Ok(RoutineSuggestions {
            status,
            suggestions: fill(user, &stored, &dismissed_templates, &saved_from, surface),
        })
    }

    /// Check and keep one suggestion `session` handed back.
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        user: &MacroUserIdStr<'static>,
        session: &SuggestionSession,
        request: SuggestRequest,
    ) -> Result<SuggestOutcome> {
        if session.kept >= MAX_KEPT_PER_SESSION {
            return Ok(rejected(vec![format!(
                "you suggested {MAX_KEPT_PER_SESSION} routines; that is enough, stop now"
            )]));
        }
        let (checked, check) = match request {
            SuggestRequest::Catalog {
                key,
                knobs,
                reason,
                surfaces,
                keep_probability,
            } => {
                let (stored, dismissed) = tokio::try_join!(
                    self.repo.suggestions(user),
                    self.repo.dismissed_templates(user),
                )?;
                let taken = dismissed.iter().any(|dismissed| *dismissed == key)
                    || stored.iter().any(|suggestion| {
                        matches!(&suggestion.pick, StoredPick::Catalog { key: taken, .. } if *taken == key)
                    });
                if taken {
                    return Ok(rejected(vec![format!(
                        "`{key}` was suggested already or dismissed; suggest something else"
                    )]));
                }
                (
                    decode::catalog_pick(
                        &key,
                        knobs,
                        &reason,
                        surfaces,
                        keep_probability,
                        &session.surfaces,
                    ),
                    None,
                )
            }
            SuggestRequest::Routine {
                routine,
                created,
                reason,
                surfaces,
                keep_probability,
            } => {
                let check = self
                    .actions
                    .check_action(principal, routine, created, None)
                    .await?;
                if !check.ok {
                    return Ok(SuggestOutcome {
                        ok: false,
                        problems: check.problems.clone(),
                        check: Some(check),
                        id: None,
                    });
                }
                (
                    decode::drafted_pick(
                        check.routine.clone(),
                        &reason,
                        surfaces,
                        keep_probability,
                        &session.surfaces,
                    ),
                    Some(check),
                )
            }
        };
        match checked {
            Ok(checked) => {
                let id = self
                    .repo
                    .add(user, session.session, &checked, Utc::now())
                    .await?;
                Ok(SuggestOutcome {
                    ok: true,
                    problems: Vec::new(),
                    check,
                    id: Some(id),
                })
            }
            Err(problems) => Ok(SuggestOutcome {
                ok: false,
                problems,
                check,
                id: None,
            }),
        }
    }

    /// The person's one generation: every session of the layout at once,
    /// each retried once when it suggested nothing.
    async fn generate(self: Arc<Self>, run: Run, shutdown: CancellationToken) {
        let span = tracing::Span::current();
        let started = tokio::time::Instant::now();
        let user = run.user.clone();
        let (inbox, apps, dismissed) = tokio::join!(
            self.sources.inbox(&user, INBOX_MESSAGES),
            self.sources.apps(&user),
            self.dismissed_names(&user),
        );
        let inbox = inbox
            .inspect_err(|error| tracing::warn!(error = ?error, "could not read the inbox to suggest routines"))
            .unwrap_or_default();
        let apps = apps
            .inspect_err(|error| tracing::warn!(error = ?error, "could not read connected apps to suggest routines"))
            .unwrap_or_default();
        span.record("routine.suggestions.inbox_messages", inbox.len());
        span.record("routine.suggestions.apps", apps.len());
        let runs = self.layout.sessions().iter().map(|surfaces| {
            let brief = prompt::brief(&prompt::BriefData {
                surfaces,
                inbox: &inbox,
                apps: &apps,
                dismissed: &dismissed,
                timezone: run.timezone.name(),
                agent_model: &self.agent.model,
                code: run.code,
                guide: self.agent.guide,
            });
            self.suggest_for(&user, surfaces, brief, &shutdown)
        });
        let kept: Vec<(u32, bool)> = futures::future::join_all(runs).await;
        let total: u32 = kept.iter().map(|(kept, _)| kept).sum();
        let retries = kept.iter().filter(|(_, retried)| *retried).count();
        let outcome = if shutdown.is_cancelled() && total == 0 {
            GenerationOutcome::Cancelled
        } else if kept.iter().all(|(kept, _)| *kept > 0) {
            GenerationOutcome::Ready
        } else if total > 0 {
            GenerationOutcome::Partial
        } else {
            GenerationOutcome::Failed
        };
        if outcome != GenerationOutcome::Cancelled
            && let Err(error) = self.repo.finish(&user, total > 0, Utc::now()).await
        {
            tracing::error!(error = ?error, "could not record a routine suggestion generation");
        }
        span.record("routine.suggestions.kept", total);
        span.record("routine.suggestions.retries", retries);
        span.record("routine.suggestions.outcome", outcome.as_ref());
        if let Ok(Some(first)) = self.first_kept_ms(&user, started).await {
            span.record("routine.suggestions.first_ms", first);
        }
        tracing::info!(
            event = "routine_suggestions.generated",
            outcome = outcome.as_ref(),
            sessions = kept.len(),
            kept = total,
            retries,
            inbox_messages = inbox.len(),
            duration_ms = started.elapsed().as_millis() as u64,
        );
    }

    /// How long after `started` the first suggestion was kept.
    async fn first_kept_ms(
        &self,
        user: &MacroUserIdStr<'static>,
        started: tokio::time::Instant,
    ) -> Result<Option<u64>> {
        let began = Utc::now() - chrono::Duration::from_std(started.elapsed())?;
        let first = self
            .repo
            .suggestions(user)
            .await?
            .iter()
            .map(|suggestion| suggestion.created_at)
            .min();
        Ok(first.map(|first| (first - began).num_milliseconds().max(0) as u64))
    }

    /// Catalog keys and routine names the person was suggested or dismissed.
    async fn dismissed_names(&self, user: &MacroUserIdStr<'static>) -> Vec<String> {
        let (stored, templates) = tokio::join!(
            self.repo.suggestions(user),
            self.repo.dismissed_templates(user),
        );
        let mut names = templates.unwrap_or_default();
        names.extend(stored.unwrap_or_default().into_iter().map(
            |suggestion| match suggestion.pick {
                StoredPick::Catalog { key, .. } => key,
                StoredPick::Routine { routine } => routine.name,
            },
        ));
        names
    }

    /// One session for `surfaces`, retried once when it kept nothing. How
    /// many it kept, and whether it was retried.
    async fn suggest_for(
        &self,
        user: &MacroUserIdStr<'static>,
        surfaces: &[Surface],
        brief: String,
        shutdown: &CancellationToken,
    ) -> (u32, bool) {
        let kept = self
            .session(user, surfaces, brief.clone(), 1, shutdown)
            .await;
        if kept > 0 || shutdown.is_cancelled() {
            return (kept, false);
        }
        (self.session(user, surfaces, brief, 2, shutdown).await, true)
    }

    /// Run one hidden session with `brief` until its turn ends, then stop
    /// and delete it. How many suggestions it kept.
    async fn session(
        &self,
        user: &MacroUserIdStr<'static>,
        surfaces: &[Surface],
        brief: String,
        attempt: u8,
        shutdown: &CancellationToken,
    ) -> u32 {
        let session = AgentSessionId::new();
        let span = tracing::info_span!(
            "routine.suggestions.session",
            agent.session.id = %session,
            routine.suggestions.surfaces = ?surfaces,
            routine.suggestions.attempt = attempt,
            routine.suggestions.kept = tracing::field::Empty,
            routine.suggestions.status_reads = tracing::field::Empty,
            routine.suggestions.tool_calls = tracing::field::Empty,
            routine.suggestions.turns = tracing::field::Empty,
            routine.suggestions.ended = tracing::field::Empty,
        );
        async {
            let action = RoutineSessionAction {
                owner: user.clone(),
                bot_id: self.agent.bot,
                session_id: session,
                action_id: AgentActionId::mint(),
            };
            if let Err(error) = self
                .repo
                .open_session(session.as_uuid(), user, self.agent.bot, surfaces, Utc::now())
                .await
            {
                tracing::error!(error = ?error, "could not open a routine suggestion session");
                return 0;
            }
            let ending = tokio::select! {
                ending = tokio::time::timeout(SESSION_TIMEOUT, self.run(&action, brief)) => match ending {
                    Ok(Ok(ending)) => ending,
                    Ok(Err(error)) => {
                        tracing::warn!(error = ?error, "a routine suggestion session failed");
                        Ending::Failed
                    }
                    Err(_) => Ending::TimedOut,
                },
                () = shutdown.cancelled() => Ending::Cancelled,
            };
            let span = tracing::Span::current();
            span.record("routine.suggestions.ended", ending.as_ref());
            let stopped = ending == Ending::Finished || self.stop(&action).await;
            let kept = self
                .repo
                .session(session.as_uuid())
                .await
                .ok()
                .flatten()
                .map_or(0, |session| session.kept);
            span.record("routine.suggestions.kept", kept);
            if let Ok(activity) = self.sessions.activity(action.clone()).await {
                span.record("routine.suggestions.tool_calls", activity.tool_calls);
                span.record("routine.suggestions.turns", activity.turns);
            }
            self.clean_up(&action, stopped).await;
            kept
        }
        .instrument(span)
        .await
    }

    /// Open the hidden session, prompt it once and wait for its turn to end.
    async fn run(
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
                // Unlike a draft's, its turns are metered but never billed.
                metering: SessionMetering::RoutineSuggestions,
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
            span.record("routine.suggestions.status_reads", reads);
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
                tracing::warn!(error = ?error, "could not stop a routine suggestion session");
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
            tracing::warn!(error = ?error, "could not delete a routine suggestion session");
        }
        if let Err(error) = self.repo.close_session(action.session_id.as_uuid()).await {
            tracing::warn!(error = ?error, "could not close a routine suggestion session");
        }
    }
}

fn action_for(session: &SuggestionSession) -> RoutineSessionAction {
    RoutineSessionAction {
        owner: session.owner.clone(),
        bot_id: session.agent,
        session_id: AgentSessionId::new_from_uuid(session.session),
        action_id: AgentActionId::mint(),
    }
}

fn rejected(problems: Vec<String>) -> SuggestOutcome {
    SuggestOutcome {
        ok: false,
        problems,
        check: None,
        id: None,
    }
}

/// Per surface (only `surface`, when given), AI's open suggestions best
/// first, then catalog routines marked `suggest` as Macro's templates, to
/// [`PER_SURFACE`]. Skips what the person dismissed or saved a routine
/// from, and a template AI already picked. Each suggestion appears once,
/// in the order its first surface reached it.
pub fn fill(
    user: &MacroUserIdStr<'_>,
    stored: &[StoredSuggestion],
    dismissed_templates: &[String],
    saved_from: &[Uuid],
    surface: Option<Surface>,
) -> Vec<RoutineSuggestion> {
    let saved: HashSet<&Uuid> = saved_from.iter().collect();
    // Catalog keys AI picked (open, dismissed or saved) never show again as
    // Macro's templates.
    let picked: HashSet<&str> = stored
        .iter()
        .filter_map(|suggestion| match &suggestion.pick {
            StoredPick::Catalog { key, .. } => Some(key.as_str()),
            StoredPick::Routine { .. } => None,
        })
        .collect();
    let mut open: Vec<&StoredSuggestion> = stored
        .iter()
        .filter(|suggestion| !suggestion.dismissed && !saved.contains(&suggestion.id))
        .collect();
    open.sort_by(|a, b| b.keep_probability.total_cmp(&a.keep_probability));
    let on_by_default: HashSet<Uuid> = open
        .iter()
        .filter(|suggestion| match &suggestion.pick {
            StoredPick::Catalog { key, .. } => {
                suggestion.keep_probability >= ON_BY_DEFAULT_KEEP
                    && routine_program::catalog_routine(key)
                        .is_some_and(|routine| routine.safe_default)
            }
            StoredPick::Routine { .. } => false,
        })
        .take(MAX_ON_BY_DEFAULT)
        .map(|suggestion| suggestion.id)
        .collect();
    let surfaces: Vec<Surface> = match surface {
        Some(surface) => vec![surface],
        None => ALL_SURFACES.to_vec(),
    };
    let mut shown: Vec<RoutineSuggestion> = Vec::new();
    let mut ids: HashSet<Uuid> = HashSet::new();
    for surface in surfaces {
        let mut count = shown
            .iter()
            .filter(|suggestion| suggestion.surfaces.contains(&surface))
            .count();
        for suggestion in open.iter().filter(|s| s.surfaces.contains(&surface)) {
            if count >= PER_SURFACE {
                break;
            }
            if ids.insert(suggestion.id) {
                shown.push(for_you(suggestion, on_by_default.contains(&suggestion.id)));
                count += 1;
            }
        }
        for routine in CATALOG.iter().filter(|routine| {
            routine.suggest
                && routine.surfaces.contains(&surface)
                && !picked.contains(routine.key)
                && !dismissed_templates.iter().any(|key| key == routine.key)
        }) {
            if count >= PER_SURFACE {
                break;
            }
            let id = template_id(user, routine.key);
            if saved.contains(&id) {
                continue;
            }
            if ids.insert(id) {
                shown.push(RoutineSuggestion {
                    id,
                    from: SuggestionFrom::Macro,
                    surfaces: routine.surfaces.to_vec(),
                    reason: None,
                    keep_probability: None,
                    on_by_default: false,
                    pick: SuggestedPick::Catalog {
                        key: routine.key.to_owned(),
                        knobs: serde_json::Map::new(),
                    },
                });
                count += 1;
            }
        }
    }
    shown
}

fn for_you(suggestion: &StoredSuggestion, on_by_default: bool) -> RoutineSuggestion {
    RoutineSuggestion {
        id: suggestion.id,
        from: SuggestionFrom::ForYou,
        surfaces: suggestion.surfaces.clone(),
        reason: Some(suggestion.reason.clone()),
        keep_probability: Some(suggestion.keep_probability),
        on_by_default,
        pick: match &suggestion.pick {
            StoredPick::Catalog { key, knobs } => SuggestedPick::Catalog {
                key: key.clone(),
                knobs: knobs.clone(),
            },
            StoredPick::Routine { routine } => SuggestedPick::Routine {
                routine: routine.clone(),
            },
        },
    }
}
