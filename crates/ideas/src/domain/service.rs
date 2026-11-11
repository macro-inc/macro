//! The ideas service: the person's feed, which they and their own agent
//! read and act on, and the tools hidden generation sessions write it with.
//!
//! Code here only validates and stores. Which ideas exist, how they are
//! worded and ranked, and when one stops mattering are all decided by the
//! generation sessions through these tools; a refused write answers with
//! problems the session can read and fix. Every accepted write is logged in
//! the change log with the values before and after and the session's reason.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use feature_flags::FeatureFlags;
use futures::{StreamExt as _, TryStreamExt as _};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::check;
use super::model::{
    Accept, AttachDraft, Change, ChangeAction, EntityAction, GenerationSession, GenerationTrigger,
    Idea, IdeaCaller, IdeaContent, IdeaError, IdeaKind, IdeaReview, IdeaRun, IdeaState,
    IdeaWriteOutcome, Ideas, KindName, RetireIdea, RewriteIdea, RunMode, RunProgress, RunSettled,
    RunStartError, SessionKind, SessionReadError, SessionState, StoredRun, SuggestIdea, Target,
};
use super::ports::{
    GenerationSessions, IdeaAccess, IdeaApi, IdeaDrafts, IdeaRepo, Limits, RequestSessions,
    RoutineSuggestionDismissal, RunSessions, SuggestionAudience, Written,
};
use super::prompt;

#[cfg(test)]
pub(crate) mod test;

/// The PostHog flag that turns ideas on for a person.
pub const IDEAS_FLAG: &str = "enable-suggestions";
/// Most open ideas a person may have.
pub const OPEN_LIMIT: u32 = 30;
/// Most ideas one generation may add or bring back.
pub const NEW_PER_GENERATION: u32 = 12;

/// How long a finished idea stays in the feed's `done`.
pub const DONE_WITHIN: chrono::TimeDelta = chrono::TimeDelta::hours(24);

/// Ideas whose items the feed checks at once.
const ACCESS_CHECKS_AT_ONCE: usize = 8;

/// How many of the person's closed ideas a session's review shows, most
/// recently closed first: enough not to suggest again what they just turned
/// down. Older ones still count: proposing one comes back to the same row.
const REVIEW_CLOSED: u32 = 60;

const LIMITS: Limits = Limits {
    open: OPEN_LIMIT,
    new_per_generation: NEW_PER_GENERATION,
};

/// Serves ideas from `Repo`, checking items with `Access` and drafts with
/// `Drafts`.
pub struct IdeaService<Repo, Access, Drafts, Flags> {
    repo: Arc<Repo>,
    access: Arc<Access>,
    drafts: Arc<Drafts>,
    request_sessions: Arc<dyn RequestSessions>,
    generation_sessions: Arc<dyn GenerationSessions>,
    audience: Arc<dyn SuggestionAudience>,
    routine_suggestions: Arc<dyn RoutineSuggestionDismissal>,
    runs: Option<Runs>,
    flags: Option<Flags>,
    /// The SDK reference an ideas session's brief carries.
    sdk_reference: String,
    /// The model an ideas session has check each new idea against its items.
    checker_model: String,
}

/// The sessions background prompt ideas run in, and the agent they run as.
struct Runs {
    sessions: Arc<dyn RunSessions>,
    agent: Uuid,
}

/// Runs one settle pass checks at most.
const SETTLE_BATCH: u16 = 50;

/// How long a run's session has to open and take its prompt. Past it, a
/// session that is missing or still waiting for its prompt never started,
/// and one whose in-process runtime went away (a restart) won't resume.
const START_WINDOW: chrono::Duration = chrono::Duration::minutes(10);

impl<Repo, Access, Drafts, Flags> IdeaService<Repo, Access, Drafts, Flags>
where
    Repo: IdeaRepo,
    Access: IdeaAccess,
    Drafts: IdeaDrafts,
    Flags: FeatureFlags + 'static,
{
    /// Without `flags`, ideas are off for everyone.
    #[expect(clippy::too_many_arguments, reason = "each port is its own adapter")]
    pub fn new(
        repo: Arc<Repo>,
        access: Arc<Access>,
        drafts: Arc<Drafts>,
        request_sessions: Arc<dyn RequestSessions>,
        generation_sessions: Arc<dyn GenerationSessions>,
        audience: Arc<dyn SuggestionAudience>,
        routine_suggestions: Arc<dyn RoutineSuggestionDismissal>,
        flags: Option<Flags>,
    ) -> Self {
        Self {
            repo,
            access,
            drafts,
            request_sessions,
            generation_sessions,
            audience,
            routine_suggestions,
            runs: None,
            flags,
            sdk_reference: String::new(),
            checker_model: String::new(),
        }
    }

    /// Hand ideas sessions `reference`, the SDK methods and fields they use
    /// ([`prompt::SYMBOLS`], [`prompt::FIELDS_OF`]), so they skip reading the
    /// documentation.
    pub fn with_sdk_reference(mut self, reference: String) -> Self {
        self.sdk_reference = reference;
        self
    }

    /// Have ideas sessions check each new idea against its items with
    /// `model`, in a completion that sees nothing else.
    pub fn with_checker_model(mut self, model: String) -> Self {
        self.checker_model = model;
        self
    }

    /// Run background prompt ideas in `sessions`, as agent `agent`. Without
    /// it, accepting one fails.
    pub fn with_runs(mut self, sessions: Arc<dyn RunSessions>, agent: Uuid) -> Self {
        self.runs = Some(Runs { sessions, agent });
        self
    }

    /// Attach each idea's latest run, with how it is going read from its
    /// session.
    async fn attach_runs(
        &self,
        user: &MacroUserIdStr<'_>,
        ideas: &mut [Idea],
    ) -> Result<(), IdeaError> {
        // Only background prompt ideas run.
        let ids: Vec<Uuid> = ideas
            .iter()
            .filter(|idea| {
                matches!(
                    idea.kind,
                    IdeaKind::Prompt {
                        run_mode: RunMode::Background,
                        ..
                    }
                )
            })
            .map(|idea| idea.id)
            .collect();
        let runs = self
            .repo
            .latest_runs(user, &ids)
            .await
            .map_err(IdeaError::internal)?;
        for idea in ideas.iter_mut() {
            let Some(run) = runs.iter().find(|run| run.idea == idea.id) else {
                continue;
            };
            let progress = match (&run.settled, &self.runs) {
                (Some(RunSettled::Finished), _) => RunProgress::Finished,
                (Some(RunSettled::Failed), _) => RunProgress::Failed,
                (None, Some(runs)) => runs
                    .sessions
                    .state(run)
                    .await
                    .inspect_err(|error| tracing::warn!(?error, "could not read a run's session"))
                    .map_or(RunProgress::Unknown, SessionState::progress),
                (None, None) => RunProgress::Unknown,
            };
            idea.run = Some(IdeaRun {
                session_id: run.session,
                started_at: run.started_at,
                progress,
            });
        }
        Ok(())
    }

    /// Move `idea` from one of `from` to `to` if it is still as `accept`
    /// says the caller saw it; when it changed, the idea as it is now.
    async fn move_as_shown(
        &self,
        user: &MacroUserIdStr<'static>,
        idea: &Idea,
        from: &[IdeaState],
        to: IdeaState,
        accept: Accept,
    ) -> Result<(), IdeaError> {
        if idea.updated_at != accept.shown_updated_at {
            return Err(IdeaError::Changed(Box::new(idea.clone())));
        }
        let moved = self
            .repo
            .set_state_as_shown(user, idea.id, from, to, accept.shown_updated_at, Utc::now())
            .await
            .map_err(IdeaError::internal)?;
        if moved {
            return Ok(());
        }
        let now = self
            .repo
            .idea(user, idea.id)
            .await
            .map_err(IdeaError::internal)?;
        Err(match now {
            Some(now) if now.updated_at != accept.shown_updated_at => {
                IdeaError::Changed(Box::new(now))
            }
            _ => IdeaError::NotFound,
        })
    }

    /// Start a run of background prompt idea `idea`.
    #[tracing::instrument(name = "ideas.run.start", skip_all, fields(
        idea.id = %idea.id,
        agent.session.id = tracing::field::Empty,
        idea.run.outcome = tracing::field::Empty,
    ), err)]
    async fn start_run(
        &self,
        user: &MacroUserIdStr<'static>,
        idea: &Idea,
        prompt: &str,
        shown_updated_at: DateTime<Utc>,
    ) -> Result<(), IdeaError> {
        let span = tracing::Span::current();
        let Some(runs) = &self.runs else {
            return Err(IdeaError::Internal(rootcause::report!(
                "background runs are not configured"
            )));
        };
        let run = StoredRun {
            session: Uuid::now_v7(),
            idea: idea.id,
            user: user.clone(),
            agent: runs.agent,
            action: Uuid::now_v7(),
            started_at: Utc::now(),
            settled: None,
        };
        span.record("agent.session.id", run.session.to_string());
        // What runs is what the person saw: a card read before the idea
        // was rewritten is read again first.
        if idea.updated_at != shown_updated_at {
            span.record("idea.run.outcome", "changed");
            return Err(IdeaError::Changed(Box::new(idea.clone())));
        }
        // The row first, so two accepts at once start one session.
        if !self
            .repo
            .start_run(&run, shown_updated_at)
            .await
            .map_err(IdeaError::internal)?
        {
            span.record("idea.run.outcome", "not_runnable");
            let now = self
                .repo
                .idea(user, idea.id)
                .await
                .map_err(IdeaError::internal)?;
            return Err(match now {
                Some(now) if now.updated_at != shown_updated_at => {
                    IdeaError::Changed(Box::new(now))
                }
                _ => IdeaError::NotFound,
            });
        }
        match runs.sessions.start(&run, prompt).await {
            Ok(()) => {}
            Err(RunStartError::NotStarted(error)) => {
                // Nothing runs: the idea may be accepted again to retry.
                let _ = self
                    .repo
                    .settle_run(run.session, RunSettled::Failed, &[], Utc::now())
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(?error, "could not settle a run that failed to start")
                    });
                span.record("idea.run.outcome", "failed_to_start");
                return Err(IdeaError::Internal(error));
            }
            Err(RunStartError::Uncertain(error)) => {
                // The prompt may be running: the run stays unsettled, so no
                // second session starts, and its session settles it.
                tracing::warn!(?error, "a run's prompt may not have arrived");
                span.record("idea.run.outcome", "uncertain");
                return Ok(());
            }
        }
        span.record("idea.run.outcome", "started");
        tracing::info!(event = "ideas.run_started");
        Ok(())
    }

    #[tracing::instrument(name = "ideas.flag", err, skip_all)]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<(), IdeaError> {
        let Some(flags) = &self.flags else {
            return Err(IdeaError::NotFound);
        };
        let enabled = flags
            .load(user)
            .await
            .inspect_err(|error| {
                tracing::warn!(?error, "feature flags unavailable; suggestions stay off");
            })
            .is_ok_and(|flags| flags.is_enabled(IDEAS_FLAG));
        if enabled {
            Ok(())
        } else {
            Err(IdeaError::NotFound)
        }
    }

    /// The person's open ideas session the request came from.
    async fn session(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<GenerationSession, IdeaError> {
        let owner = principal.owner();
        let user = owner.as_user().ok_or(IdeaError::NotGenerating)?;
        let session = match correlation {
            Some(correlation) => self
                .request_sessions
                .session_of(correlation)
                .await
                .map_err(IdeaError::Internal)?,
            None => None,
        };
        let session = match session {
            Some(session) => self
                .generation_sessions
                .open_session(session)
                .await
                .map_err(IdeaError::Internal)?,
            None => None,
        };
        let session = session
            .filter(|session| session.user == *user && session.kind == SessionKind::Ideas)
            .ok_or(IdeaError::NotGenerating)?;
        self.require_flag(&session.user).await?;
        let span = tracing::Span::current();
        span.record("agent.session.id", session.session.to_string());
        span.record("suggestion.generation.id", session.generation.to_string());
        if let Some(trace) = &session.trace_id {
            span.record("suggestion.generation.trace_id", trace.as_str());
        }
        Ok(session)
    }

    /// Admit the person, or an agent acting for them, to their feed. A
    /// generation session is refused: it is hidden, and manages the feed
    /// only through its own tools. Records the caller's kind on the span.
    async fn admit(&self, caller: IdeaCaller) -> Result<(), IdeaError> {
        tracing::Span::current().record("ideas.caller", caller.as_ref());
        let IdeaCaller::Agent {
            correlation: Some(correlation),
        } = caller
        else {
            return Ok(());
        };
        let session = self
            .request_sessions
            .session_of(correlation)
            .await
            .map_err(IdeaError::Internal)?;
        let Some(session) = session else {
            return Ok(());
        };
        let generation = self
            .generation_sessions
            .open_session(session)
            .await
            .map_err(IdeaError::Internal)?;
        if generation.is_some() {
            return Err(IdeaError::Generating);
        }
        Ok(())
    }

    /// Items in `targets` the person can't open, as problems.
    async fn inaccessible(
        &self,
        user: &MacroUserIdStr<'_>,
        targets: &[Target],
        problems: &mut Vec<String>,
    ) -> Result<(), IdeaError> {
        for target in targets {
            let mut viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(IdeaError::internal)?;
            if let Some(part) = target.part_id.as_deref().filter(|_| viewable) {
                viewable = self
                    .access
                    .is_part_of(target, part)
                    .await
                    .map_err(IdeaError::internal)?;
            }
            if !viewable {
                let item = target.entity_type.as_ref();
                problems.push(match &target.part_id {
                    Some(part) => format!(
                        "the user can't open {item} `{}`, or `{part}` isn't one of its parts \
                         (a message of a channel or email thread); a suggestion is only about \
                         items they can open",
                        target.entity_id
                    ),
                    None => format!(
                        "the user can't open {item} `{}`; a suggestion is only about items they \
                         can open",
                        target.entity_id
                    ),
                });
            }
        }
        Ok(())
    }

    /// Whether the person can open every item `idea` is about.
    async fn viewable(&self, user: &MacroUserIdStr<'_>, idea: &Idea) -> Result<bool, IdeaError> {
        for target in &idea.about {
            let viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(IdeaError::internal)?;
            if !viewable {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The idea as stored after a write.
    async fn reread(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        match self
            .repo
            .idea(user, id)
            .await
            .map_err(IdeaError::internal)?
        {
            Some(idea) => Ok(IdeaWriteOutcome::applied(idea)),
            None => Err(IdeaError::NotFound),
        }
    }
}

/// A write's outcome as a problem the session can act on.
fn written_problem(written: Written) -> Option<String> {
    match written {
        Written::Applied => None,
        Written::OverOpenLimit => Some(format!(
            "the user has {OPEN_LIMIT} open suggestions; retire one that matters less first"
        )),
        Written::OverNewLimit => Some(format!(
            "this generation added {NEW_PER_GENERATION} suggestions, the most for one night; stop adding"
        )),
        Written::Conflict => Some(
            "the suggestion changed while you wrote it; read it again with `macro.suggestions.review` and retry"
                .to_owned(),
        ),
    }
}

fn snapshot(content: &IdeaContent) -> Option<serde_json::Value> {
    serde_json::to_value(content).ok()
}

/// An idea's draft, as the change log keeps it: `{"draft": target or null}`.
fn draft_snapshot(draft: Option<&Target>) -> Option<serde_json::Value> {
    let mut value = serde_json::Map::new();
    value.insert("draft".to_owned(), serde_json::to_value(draft).ok()?);
    Some(serde_json::Value::Object(value))
}

impl<Repo, Access, Drafts, Flags> IdeaApi for IdeaService<Repo, Access, Drafts, Flags>
where
    Repo: IdeaRepo,
    Access: IdeaAccess,
    Drafts: IdeaDrafts,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "ideas.feed", skip_all, fields(
        ideas.caller = tracing::field::Empty,
        ideas.open = tracing::field::Empty,
        ideas.done = tracing::field::Empty,
        ideas.hidden = tracing::field::Empty,
    ), err)]
    async fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        timezone: Option<chrono_tz::Tz>,
    ) -> Result<Ideas, IdeaError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        if let Some(timezone) = timezone {
            // Reading the feed counts the person in for nightly generations;
            // a failure here never fails the read.
            let _ = self
                .audience
                .seen(user, timezone.name(), Utc::now())
                .await
                .inspect_err(|error| {
                    tracing::warn!(?error, "could not record a suggestions reader")
                });
        }
        let done_since = Utc::now() - DONE_WITHIN;
        let shown: Vec<Idea> = self
            .repo
            .shown(user, done_since)
            .await
            .map_err(IdeaError::internal)?;
        let before = shown.len();
        // Up to 30 ideas of up to 5 items each: check a few at a time.
        let viewable: Vec<Idea> = futures::stream::iter(shown)
            .map(|idea| async move {
                Ok::<_, IdeaError>(self.viewable(user, &idea).await?.then_some(idea))
            })
            .buffer_unordered(ACCESS_CHECKS_AT_ONCE)
            .try_filter_map(|idea| async move { Ok(idea) })
            .try_collect()
            .await?;
        let hidden = before - viewable.len();
        // One read of runs for the open and the done ideas.
        let mut viewable = viewable;
        self.attach_runs(user, &mut viewable).await?;
        let (mut ideas, mut done): (Vec<Idea>, Vec<Idea>) =
            viewable.into_iter().partition(|idea| idea.state.is_open());
        ideas.sort_by(|a, b| {
            b.importance
                .cmp(&a.importance)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        done.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let span = tracing::Span::current();
        span.record("ideas.open", ideas.len());
        span.record("ideas.done", done.len());
        span.record("ideas.hidden", hidden);
        Ok(Ideas { ideas, done })
    }

    fn brief(&self, trigger: GenerationTrigger, timezone: chrono_tz::Tz) -> String {
        prompt::brief(
            trigger,
            timezone.name(),
            Utc::now(),
            &self.sdk_reference,
            &self.checker_model,
        )
    }

    async fn kept(&self, generation: Uuid, session: Uuid) -> Result<u32, IdeaError> {
        self.repo
            .kept_by(generation, session)
            .await
            .map_err(IdeaError::internal)
    }

    #[tracing::instrument(name = "ideas.accept", skip_all, fields(
        idea.id = %id,
        ideas.caller = tracing::field::Empty,
    ), err)]
    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        id: Uuid,
        accept: Accept,
    ) -> Result<(), IdeaError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        let idea = self
            .repo
            .idea(user, id)
            .await
            .map_err(IdeaError::internal)?
            .ok_or(IdeaError::NotFound)?;
        if let IdeaKind::Prompt {
            prompt,
            run_mode: RunMode::Background,
            sends,
        } = &idea.kind
        {
            // Only the person, in the app, starts a run: anyone acting for
            // them at most takes the idea on, for them to run.
            if !(accept.by_person && caller == IdeaCaller::User) {
                if idea.state == IdeaState::Accepted {
                    return Ok(());
                }
                self.move_as_shown(
                    user,
                    &idea,
                    &[IdeaState::Proposed],
                    IdeaState::Accepted,
                    accept,
                )
                .await?;
                tracing::info!(event = "ideas.accepted", run = false);
                return Ok(());
            }
            return self
                .start_run(
                    user,
                    &idea,
                    &run_prompt(prompt, sends.as_deref()),
                    accept.shown_updated_at,
                )
                .await;
        }
        // Anything else the person acts on themself (opens the item, the
        // composer, the routine) is done when they do; accepting a done idea
        // again changes nothing.
        if idea.state == IdeaState::Done {
            return Ok(());
        }
        // What the person opens is what they saw: a card read before the
        // idea was rewritten is read again first.
        self.move_as_shown(
            user,
            &idea,
            &[IdeaState::Proposed, IdeaState::Accepted],
            IdeaState::Done,
            accept,
        )
        .await?;
        tracing::info!(event = "ideas.accepted", done = true);
        Ok(())
    }

    #[tracing::instrument(name = "ideas.runs.settle", skip_all, fields(
        ideas.runs.checked = tracing::field::Empty,
        ideas.runs.settled = tracing::field::Empty,
    ), err)]
    async fn settle_runs(&self) -> Result<usize, IdeaError> {
        let Some(runs) = &self.runs else {
            return Ok(0);
        };
        let unsettled = self
            .repo
            .unsettled_runs(SETTLE_BATCH)
            .await
            .map_err(IdeaError::internal)?;
        let mut settled = 0;
        for run in &unsettled {
            let now = Utc::now();
            if let Err(error) = self.repo.checked_run(run.session, now).await {
                tracing::warn!(?error, "could not record a run's check");
            }
            let started_long_ago = now - run.started_at >= START_WINDOW;
            let (outcome, produced) = match runs.sessions.state(run).await {
                // It may be running: a run is given up only on what is known.
                Err(SessionReadError::Unreadable(error)) => {
                    tracing::warn!(?error, "could not read a run's session");
                    continue;
                }
                // Its session never opened, or is gone: nothing runs. Within
                // the start window it may still be opening.
                Err(SessionReadError::Missing) => {
                    if !started_long_ago {
                        continue;
                    }
                    tracing::warn!(event = "ideas.run_session_missing");
                    (RunSettled::Failed, Vec::new())
                }
                // Its runtime went away mid-run (a restart): once its session
                // is gone it can't resume, and the idea may be tried again.
                // Its prompt never arrived: likewise. Nobody watches a run,
                // so one waiting for an approval or an answer never gets one.
                Ok(
                    SessionState::AwaitingPrompt
                    | SessionState::Disconnected
                    | SessionState::NeedsApproval
                    | SessionState::NeedsInput,
                ) => {
                    if !started_long_ago {
                        continue;
                    }
                    if let Err(error) = runs.sessions.discard(run).await {
                        tracing::warn!(?error, "could not delete a run's unprompted session");
                        continue;
                    }
                    (RunSettled::Failed, Vec::new())
                }
                Ok(SessionState::Finished) => {
                    // The session is the result; the items it made come with it.
                    let mut produced = vec![Target {
                        entity_type: model_entity::EntityType::AgentSession,
                        entity_id: run.session.to_string(),
                        part_id: None,
                    }];
                    match runs.sessions.produced(run).await {
                        Ok(items) => produced.extend(items),
                        Err(error) => {
                            tracing::warn!(?error, "could not read what a run made");
                            continue;
                        }
                    }
                    (RunSettled::Finished, produced)
                }
                Ok(SessionState::Failed) => (RunSettled::Failed, Vec::new()),
                Ok(SessionState::Running) => continue,
            };
            let moved = self
                .repo
                .settle_run(run.session, outcome, &produced, now)
                .await
                .map_err(IdeaError::internal)?;
            settled += usize::from(moved);
            tracing::info!(
                event = "ideas.run_settled",
                outcome = if outcome == RunSettled::Finished {
                    "finished"
                } else {
                    "failed"
                },
                produced = produced.len(),
            );
        }
        let span = tracing::Span::current();
        span.record("ideas.runs.checked", unsettled.len());
        span.record("ideas.runs.settled", settled);
        Ok(settled)
    }

    #[tracing::instrument(name = "ideas.dismiss", skip_all, fields(
        idea.id = %id,
        ideas.caller = tracing::field::Empty,
    ), err)]
    async fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        id: Uuid,
    ) -> Result<(), IdeaError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        let idea = self
            .repo
            .idea(user, id)
            .await
            .map_err(IdeaError::internal)?;
        let idea = idea
            .filter(|idea| idea.state.is_open())
            .ok_or(IdeaError::NotFound)?;
        // A routine idea and its suggestion are dismissed together, where
        // the suggestion is kept.
        if let IdeaKind::Routine {
            routine_suggestion_id,
        } = idea.kind
        {
            let dismissed = self
                .routine_suggestions
                .dismiss_suggestion(user, routine_suggestion_id)
                .await
                .map_err(IdeaError::Internal)?;
            if !dismissed {
                return Err(IdeaError::NotFound);
            }
            tracing::info!(event = "ideas.dismissed", kind = "routine");
            return Ok(());
        }
        let moved = self
            .repo
            .set_state(
                user,
                id,
                &[IdeaState::Proposed, IdeaState::Accepted],
                IdeaState::Dismissed,
                None,
                Utc::now(),
            )
            .await
            .map_err(IdeaError::internal)?;
        if !moved {
            return Err(IdeaError::NotFound);
        }
        tracing::info!(event = "ideas.dismissed");
        Ok(())
    }

    #[tracing::instrument(name = "ideas.review", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        ideas.count = tracing::field::Empty,
    ), err)]
    async fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<IdeaReview, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let (ideas, added) = tokio::try_join!(
            async {
                self.repo
                    .for_review(&session.user, REVIEW_CLOSED)
                    .await
                    .map_err(IdeaError::internal)
            },
            async {
                self.repo
                    .added_in(session.generation)
                    .await
                    .map_err(IdeaError::internal)
            },
        )?;
        let mut ideas = ideas;
        self.attach_runs(&session.user, &mut ideas).await?;
        let (mut open, mut closed): (Vec<Idea>, Vec<Idea>) =
            ideas.into_iter().partition(|idea| idea.state.is_open());
        open.sort_by(|a, b| b.importance.cmp(&a.importance));
        closed.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let open_count = u32::try_from(open.len()).unwrap_or(u32::MAX);
        open.append(&mut closed);
        tracing::Span::current().record("ideas.count", open.len());
        Ok(IdeaReview {
            ideas: open,
            open: open_count,
            open_limit: OPEN_LIMIT,
            new_left: NEW_PER_GENERATION.saturating_sub(added),
        })
    }

    #[tracing::instrument(name = "ideas.suggest", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        idea.kind = request.kind.as_ref(),
        idea.id = tracing::field::Empty,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let mut problems = Vec::new();
        let kind = check::new_kind(&request, &mut problems);
        let content = (
            check::dedup_key(&request.dedup_key, &mut problems),
            check::text(
                &request.title,
                "`title`",
                check::MAX_TITLE_CHARS,
                &mut problems,
            ),
            check::text(
                &request.summary,
                "`summary`",
                check::MAX_SUMMARY_CHARS,
                &mut problems,
            ),
            check::importance(request.importance, &mut problems),
            check::targets(request.about, &mut problems),
            request
                .prompt
                .as_deref()
                .map(|prompt| check::prompt(prompt, &mut problems)),
        );
        let reason = request.reason.as_deref().and_then(|reason| {
            check::text(reason, "`reason`", check::MAX_REASON_CHARS, &mut problems)
        });
        let (
            Some(kind),
            (Some(dedup_key), Some(title), Some(summary), Some(importance), Some(about), prompt),
        ) = (kind, content)
        else {
            return Ok(rejected(&span, problems));
        };
        let prompt = match prompt {
            Some(Some(prompt)) => Some(prompt),
            Some(None) => return Ok(rejected(&span, problems)),
            None => None,
        };
        let sends = match &request.sends {
            Some(_) if request.run_mode != Some(RunMode::Background) => {
                problems.push("`sends` is only for background prompt suggestions".to_owned());
                None
            }
            Some(sends) => check::text(sends, "`sends`", check::MAX_SENDS_CHARS, &mut problems),
            None => None,
        };
        self.inaccessible(&user, &about, &mut problems).await?;
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let content = IdeaContent {
            dedup_key,
            title,
            summary,
            importance,
            categories: check::categories(request.categories),
            about,
            prompt,
            sends,
        };
        let now = Utc::now();
        let existing = self
            .repo
            .by_dedup_key(&user, &content.dedup_key)
            .await
            .map_err(IdeaError::internal)?;
        let Some(existing) = existing else {
            let id = Uuid::now_v7();
            let change = Change {
                session: session.session,
                generation: session.generation,
                action: ChangeAction::Created,
                old: None,
                new: snapshot(&content),
                reason,
                at: now,
            };
            let written = self
                .repo
                .create(&user, id, &kind, &content, LIMITS, &change)
                .await
                .map_err(IdeaError::internal)?;
            if let Some(problem) = written_problem(written) {
                return Ok(rejected(&span, vec![problem]));
            }
            span.record("idea.id", id.to_string());
            span.record("idea.outcome", "created");
            return self.reread(&user, id).await;
        };
        span.record("idea.id", existing.id.to_string());
        if existing.kind.name() != request.kind {
            return Ok(rejected(
                &span,
                vec![format!(
                    "`{}` is a {} suggestion and a kind never changes; use another `dedupKey`",
                    existing.dedup_key,
                    existing.kind.name().as_ref()
                )],
            ));
        }
        let same_kind_data = match (&existing.kind, &kind) {
            (
                IdeaKind::Prompt { run_mode, .. },
                super::model::NewKind::Prompt { run_mode: asked },
            ) => run_mode == asked,
            (IdeaKind::Entity { action, .. }, super::model::NewKind::Entity { action: asked }) => {
                action == asked
            }
            _ => false,
        };
        if !same_kind_data {
            return Ok(rejected(
                &span,
                vec![format!(
                    "`{}` keeps its run mode or action; use another `dedupKey` for a different one",
                    existing.dedup_key
                )],
            ));
        }
        check::keeps_draft(&existing.kind, &content.about, &mut problems);
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let (action, to) = match existing.state {
            IdeaState::Proposed | IdeaState::Accepted => (ChangeAction::Rewritten, existing.state),
            IdeaState::Dismissed => {
                if reason.is_none() {
                    return Ok(rejected(
                        &span,
                        vec![format!(
                            "the user dismissed `{}` on {}; bring it back only with a `reason` \
                             saying what changed since",
                            existing.dedup_key,
                            existing.state_changed_at.format("%Y-%m-%d")
                        )],
                    ));
                }
                (ChangeAction::Restored, IdeaState::Proposed)
            }
            IdeaState::Done | IdeaState::Resolved | IdeaState::Retired => {
                (ChangeAction::Restored, IdeaState::Proposed)
            }
        };
        let change = Change {
            session: session.session,
            generation: session.generation,
            action,
            old: snapshot(&IdeaContent::of(&existing)),
            new: snapshot(&content),
            reason,
            at: now,
        };
        let written = self
            .repo
            .replace(
                &user,
                existing.id,
                &content,
                existing.state,
                to,
                LIMITS,
                &change,
            )
            .await
            .map_err(IdeaError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("idea.outcome", action.as_ref());
        self.reread(&user, existing.id).await
    }

    #[tracing::instrument(name = "ideas.rewrite", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        idea.id = %id,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .idea(&user, id)
            .await
            .map_err(IdeaError::internal)?
        else {
            return Err(IdeaError::NotFound);
        };
        let mut problems = Vec::new();
        if !existing.state.is_open() {
            problems.push(format!(
                "this suggestion is {}; only open suggestions are rewritten, and `macro.suggestions.suggest` with \
                 its `dedupKey` brings one back",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "routine suggestions follow their routine suggestion, which is never rewritten"
                    .to_owned(),
            );
        }
        if request.prompt.is_some() && existing.kind.name() != KindName::Prompt {
            problems.push("`prompt` is only for prompt suggestions".to_owned());
        }
        let background = matches!(
            existing.kind,
            IdeaKind::Prompt {
                run_mode: RunMode::Background,
                ..
            }
        );
        if request.sends.is_some() && !background {
            problems.push("`sends` is only for background prompt suggestions".to_owned());
        }
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        let mut content = IdeaContent::of(&existing);
        if let Some(title) = request.title {
            content.title = check::text(&title, "`title`", check::MAX_TITLE_CHARS, &mut problems)
                .unwrap_or_default();
        }
        if let Some(summary) = request.summary {
            content.summary = check::text(
                &summary,
                "`summary`",
                check::MAX_SUMMARY_CHARS,
                &mut problems,
            )
            .unwrap_or_default();
        }
        if let Some(importance) = request.importance {
            content.importance = check::importance(importance, &mut problems).unwrap_or_default();
        }
        if let Some(categories) = request.categories {
            content.categories = check::categories(categories);
        }
        if let Some(about) = request.about {
            if about.is_empty() && existing.kind.name() == KindName::Entity {
                problems
                    .push("an entity suggestion is about at least one item in `about`".to_owned());
            }
            if let Some(about) = check::targets(about, &mut problems) {
                self.inaccessible(&user, &about, &mut problems).await?;
                check::keeps_draft(&existing.kind, &about, &mut problems);
                content.about = about;
            }
        }
        if let Some(prompt) = request.prompt {
            content.prompt = check::prompt(&prompt, &mut problems);
        }
        if let Some(sends) = request.sends.filter(|_| background) {
            content.sends = check::text(&sends, "`sends`", check::MAX_SENDS_CHARS, &mut problems);
        }
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Rewritten,
            old: snapshot(&IdeaContent::of(&existing)),
            new: snapshot(&content),
            reason,
            at: Utc::now(),
        };
        let written = self
            .repo
            .replace(
                &user,
                id,
                &content,
                existing.state,
                existing.state,
                LIMITS,
                &change,
            )
            .await
            .map_err(IdeaError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("idea.outcome", "rewritten");
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "ideas.retire", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        idea.id = %id,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireIdea,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .idea(&user, id)
            .await
            .map_err(IdeaError::internal)?
        else {
            return Err(IdeaError::NotFound);
        };
        let mut problems = Vec::new();
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        if !existing.state.is_open() {
            problems.push(format!(
                "this suggestion is {} already, not open",
                existing.state.as_ref()
            ));
        }
        if existing.kind.name() == KindName::Routine {
            problems.push(
                "retire a routine suggestion by retiring its routine suggestion in a routines session"
                    .to_owned(),
            );
        }
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Retired,
            old: Some(serde_json::Value::String(
                existing.state.as_ref().to_owned(),
            )),
            new: Some(serde_json::Value::String(
                IdeaState::Retired.as_ref().to_owned(),
            )),
            reason,
            at: Utc::now(),
        };
        let moved = self
            .repo
            .set_state(
                &user,
                id,
                &[IdeaState::Proposed, IdeaState::Accepted],
                IdeaState::Retired,
                Some(&change),
                change.at,
            )
            .await
            .map_err(IdeaError::internal)?;
        if !moved {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record("idea.outcome", "retired");
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "ideas.attach_draft", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        idea.id = %id,
        email.draft.id = %request.email_draft_id,
        idea.outcome = tracing::field::Empty,
        idea.problems = tracing::field::Empty,
    ), err)]
    async fn attach_draft(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: AttachDraft,
    ) -> Result<IdeaWriteOutcome, IdeaError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .idea(&user, id)
            .await
            .map_err(IdeaError::internal)?
        else {
            return Err(IdeaError::NotFound);
        };
        let mut problems = Vec::new();
        let reason = check::text(
            &request.reason,
            "`reason`",
            check::MAX_REASON_CHARS,
            &mut problems,
        );
        if !existing.state.is_open() {
            problems.push(format!(
                "this suggestion is {}; a draft is only attached to an open suggestion",
                existing.state.as_ref()
            ));
        }
        let IdeaKind::Entity {
            action: EntityAction::Reply,
            draft: old,
        } = &existing.kind
        else {
            problems
                .push("a draft is only for an entity suggestion with action `reply`".to_owned());
            return Ok(rejected(&span, problems));
        };
        let thread = self
            .drafts
            .email_draft_thread(&user, request.email_draft_id)
            .await
            .map_err(IdeaError::internal)?;
        let draft = thread.map(|thread| Target {
            entity_type: EntityType::EmailThread,
            entity_id: thread.to_string(),
            part_id: Some(request.email_draft_id.to_string()),
        });
        match &draft {
            None => problems.push(
                "`emailDraftId` names no unsent draft in the user's own inboxes; write the reply \
                 with `macro.email.createDraft` first, and never send it"
                    .to_owned(),
            ),
            Some(draft) if !check::draft_is_about(draft, &existing.about) => problems.push(
                "the draft is in another thread than the one this suggestion is about; write it in that \
                 thread, from its inbox: `macro.email.createDraft({thread, replyingTo, ...}, \
                 await thread.link())`"
                    .to_owned(),
            ),
            Some(_) => {}
        }
        let Some(draft) = draft.filter(|_| problems.is_empty()) else {
            return Ok(rejected(&span, problems));
        };
        if old.as_ref() == Some(&draft) {
            span.record("idea.outcome", "unchanged");
            return Ok(IdeaWriteOutcome::applied(existing));
        }
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Rewritten,
            old: draft_snapshot(old.as_ref()),
            new: draft_snapshot(Some(&draft)),
            reason,
            at: Utc::now(),
        };
        let attached = self
            .repo
            .set_draft(&user, id, &draft, &change)
            .await
            .map_err(IdeaError::internal)?;
        if !attached {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record(
            "idea.outcome",
            if old.is_some() {
                "draft_replaced"
            } else {
                "draft_attached"
            },
        );
        self.reread(&user, id).await
    }
}

fn rejected(span: &tracing::Span, problems: Vec<String>) -> IdeaWriteOutcome {
    span.record("idea.outcome", "rejected");
    span.record("idea.problems", problems.len());
    IdeaWriteOutcome::rejected(problems)
}

/// What a background run is told: the idea's prompt, then that nobody is
/// watching, so it never stops to ask; clicking Run approved exactly what
/// the card said it posts or sends, and nothing else.
fn run_prompt(prompt: &str, sends: Option<&str>) -> String {
    let approval = match sends {
        Some(sends) => format!(
            "The card told them this run will: {sends}. Starting it approved exactly that: do \
             it, and for an email call `macro.email.sendConfirmed` with `userConfirmation` set \
             to that sentence. Post, send or share nothing else."
        ),
        None => "Post, send or share nothing: leave whatever would reach other people as a \
                 draft for them to review."
            .to_owned(),
    };
    format!(
        "{prompt}\n\nThe user started this run from a suggestion card and isn't watching: never stop \
         to ask a question or wait for an approval; decide from what you can read, and say in \
         your last message what you assumed. {approval}"
    )
}
