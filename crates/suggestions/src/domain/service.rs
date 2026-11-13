//! The suggestions service: the person's feed, which they and their own agent
//! read and act on, and the tools hidden generation sessions write it with.
//!
//! Code here only validates and stores. Which suggestions exist, how they are
//! worded and ranked, and when one stops mattering are all decided by the
//! generation sessions through these tools; a refused write answers with
//! problems the session can read and fix. Every accepted write is logged in
//! the change log with the values before and after and the session's reason.

use std::sync::Arc;

use chrono::Utc;
use feature_flags::FeatureFlags;
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::check;
use super::lifecycle::{self, LifecycleEvent};
use super::model::{
    Accept, AttachDraft, Change, ChangeAction, EntityAction, GenerationSession, GenerationTrigger,
    KindName, NewSuggestion, RetireSuggestionRequest, RewriteSuggestion, RunMode, SessionKind,
    Suggestion, SuggestionCaller, SuggestionContent, SuggestionError, SuggestionFeed,
    SuggestionKind, SuggestionState, SuggestionWriteOutcome, SuggestionsReview,
    Target,
};
use super::ports::{
    GenerationSessions, Limits, RequestSessions, RoutineSuggestionDismissal, RunSessions,
    SuggestionAccess, SuggestionApi, SuggestionAudience, SuggestionDrafts, SuggestionRepo, Written,
};
use super::prompt;
use recent::Recent;

mod recent;
mod runs;
#[cfg(test)]
pub(crate) mod test;

/// The PostHog flag that turns suggestions on for a person.
pub const SUGGESTIONS_FLAG: &str = "enable-suggestions";
/// Most open suggestions a person may have.
pub const OPEN_LIMIT: u32 = 30;
/// Most suggestions one generation may add or bring back.
pub const NEW_PER_GENERATION: u32 = 12;

/// How long a finished suggestion stays in the feed's `done`.
pub const DONE_WITHIN: chrono::TimeDelta = chrono::TimeDelta::hours(24);

/// Suggestions whose items the feed checks at once.
const ACCESS_CHECKS_AT_ONCE: usize = 8;

/// How long a person's flag is trusted before it is read again: every
/// entry point checks it, and a feed read checks it on each poll.
const FLAG_KEPT_FOR: std::time::Duration = std::time::Duration::from_secs(60);

/// How often reading the feed counts a person in for nightly generations
/// again, in the same timezone.
const READER_KEPT_FOR: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// People each in-memory memo keeps at most.
const PEOPLE_REMEMBERED: usize = 10_000;

/// How many of the person's closed suggestions a session's review shows, most
/// recently closed first: enough not to suggest again what they just turned
/// down. Older ones still count: proposing one comes back to the same row.
const REVIEW_CLOSED: u32 = 60;

const LIMITS: Limits = Limits {
    open: OPEN_LIMIT,
    new_per_generation: NEW_PER_GENERATION,
};

/// Serves suggestions from `Repo`, checking items with `Access` and drafts with
/// `Drafts`.
pub struct SuggestionService<Repo, Access, Drafts, Flags> {
    repo: Arc<Repo>,
    access: Arc<Access>,
    drafts: Arc<Drafts>,
    request_sessions: Arc<dyn RequestSessions>,
    generation_sessions: Arc<dyn GenerationSessions>,
    audience: Arc<dyn SuggestionAudience>,
    routine_suggestions: Arc<dyn RoutineSuggestionDismissal>,
    runs: Option<Runs>,
    flags: Option<Flags>,
    /// The SDK reference a suggestions session's brief carries.
    sdk_reference: String,
    /// The model a suggestions session has check each new suggestion against its items.
    checker_model: String,
    /// Each person's flag, as last read.
    flag_kept: Recent<bool>,
    /// The timezone each person was last counted in with.
    readers: Recent<chrono_tz::Tz>,
}

/// The sessions background prompt suggestions run in, and the agent they run as.
struct Runs {
    sessions: Arc<dyn RunSessions>,
    agent: Uuid,
}

impl<Repo, Access, Drafts, Flags> SuggestionService<Repo, Access, Drafts, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Drafts: SuggestionDrafts,
    Flags: FeatureFlags + 'static,
{
    /// Without `flags`, suggestions are off for everyone.
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
            flag_kept: Recent::new(FLAG_KEPT_FOR, PEOPLE_REMEMBERED),
            readers: Recent::new(READER_KEPT_FOR, PEOPLE_REMEMBERED),
        }
    }

    /// Hand suggestions sessions `reference`, the SDK methods and fields they use
    /// ([`prompt::SYMBOLS`], [`prompt::FIELDS_OF`]), so they skip reading the
    /// documentation.
    pub fn with_sdk_reference(mut self, reference: String) -> Self {
        self.sdk_reference = reference;
        self
    }

    /// Have suggestions sessions check each new suggestion against its items with
    /// `model`, in a completion that sees nothing else.
    pub fn with_checker_model(mut self, model: String) -> Self {
        self.checker_model = model;
        self
    }

    /// Run background prompt suggestions in `sessions`, as agent `agent`. Without
    /// it, accepting one fails.
    pub fn with_runs(mut self, sessions: Arc<dyn RunSessions>, agent: Uuid) -> Self {
        self.runs = Some(Runs { sessions, agent });
        self
    }

    /// Move `suggestion` from one of `from` to `to` if it is still as `accept`
    /// says the caller saw it; when it changed, the suggestion as it is now.
    async fn move_as_shown(
        &self,
        user: &MacroUserIdStr<'static>,
        suggestion: &Suggestion,
        from: &[SuggestionState],
        to: SuggestionState,
        accept: Accept,
    ) -> Result<(), SuggestionError> {
        if suggestion.updated_at != accept.shown_updated_at {
            return Err(SuggestionError::Changed(Box::new(suggestion.clone())));
        }
        let moved = self
            .repo
            .set_state_as_shown(
                user,
                suggestion.id,
                from,
                to,
                accept.shown_updated_at,
                Utc::now(),
            )
            .await
            .map_err(SuggestionError::internal)?;
        if moved {
            return Ok(());
        }
        let now = self
            .repo
            .suggestion(user, suggestion.id)
            .await
            .map_err(SuggestionError::internal)?;
        Err(match now {
            Some(now) if now.updated_at != accept.shown_updated_at => {
                SuggestionError::Changed(Box::new(now))
            }
            _ => SuggestionError::NotFound,
        })
    }

    #[tracing::instrument(name = "suggestions.flag", err, skip_all, fields(
        suggestions.flag.cached = tracing::field::Empty,
    ))]
    async fn require_flag(&self, user: &MacroUserIdStr<'_>) -> Result<(), SuggestionError> {
        let Some(flags) = &self.flags else {
            return Err(SuggestionError::NotFound);
        };
        let now = tokio::time::Instant::now();
        let kept = self.flag_kept.get(user.as_ref(), now);
        tracing::Span::current().record("suggestions.flag.cached", kept.is_some());
        let enabled = match kept {
            Some(enabled) => enabled,
            // Only a read is kept: flags that can't be read leave suggestions off
            // for this request alone.
            None => match flags.load(user).await {
                Ok(flags) => {
                    let enabled = flags.is_enabled(SUGGESTIONS_FLAG);
                    self.flag_kept.put(user.as_ref(), enabled, now);
                    enabled
                }
                Err(error) => {
                    tracing::warn!(?error, "feature flags unavailable; suggestions stay off");
                    false
                }
            },
        };
        if enabled {
            Ok(())
        } else {
            Err(SuggestionError::NotFound)
        }
    }

    /// The person's open suggestions session the request came from.
    async fn session(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<GenerationSession, SuggestionError> {
        let owner = principal.owner();
        let user = owner.as_user().ok_or(SuggestionError::NotGenerating)?;
        let session = match correlation {
            Some(correlation) => self
                .request_sessions
                .session_of(correlation)
                .await
                .map_err(SuggestionError::Internal)?,
            None => None,
        };
        let session = match session {
            Some(session) => self
                .generation_sessions
                .open_session(session)
                .await
                .map_err(SuggestionError::Internal)?,
            None => None,
        };
        let session = session
            .filter(|session| session.user == *user && session.kind == SessionKind::Suggestions)
            .ok_or(SuggestionError::NotGenerating)?;
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
    async fn admit(&self, caller: SuggestionCaller) -> Result<(), SuggestionError> {
        tracing::Span::current().record("suggestions.caller", caller.as_ref());
        let SuggestionCaller::Agent {
            correlation: Some(correlation),
        } = caller
        else {
            return Ok(());
        };
        let session = self
            .request_sessions
            .session_of(correlation)
            .await
            .map_err(SuggestionError::Internal)?;
        let Some(session) = session else {
            return Ok(());
        };
        let generation = self
            .generation_sessions
            .open_session(session)
            .await
            .map_err(SuggestionError::Internal)?;
        if generation.is_some() {
            return Err(SuggestionError::Generating);
        }
        Ok(())
    }

    /// Items in `targets` the person can't open, as problems.
    async fn inaccessible(
        &self,
        user: &MacroUserIdStr<'_>,
        targets: &[Target],
        problems: &mut Vec<String>,
    ) -> Result<(), SuggestionError> {
        for target in targets {
            let mut viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(SuggestionError::internal)?;
            if let Some(part) = target.part_id.as_deref().filter(|_| viewable) {
                viewable = self
                    .access
                    .is_part_of(target, part)
                    .await
                    .map_err(SuggestionError::internal)?;
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

    /// Whether the person can open every item `suggestion` is about.
    async fn viewable(
        &self,
        user: &MacroUserIdStr<'_>,
        suggestion: &Suggestion,
    ) -> Result<bool, SuggestionError> {
        for target in &suggestion.about {
            let viewable = self
                .access
                .can_view(user, target)
                .await
                .map_err(SuggestionError::internal)?;
            if !viewable {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The first `limit` of `ordered` the person can open every item of, in
    /// order. A suggestion whose items can't be checked is left out and logged:
    /// one failing check never fails the feed.
    async fn viewable_first(
        &self,
        user: &MacroUserIdStr<'_>,
        ordered: Vec<Suggestion>,
        limit: usize,
    ) -> Viewable {
        let mut viewable = Viewable::default();
        if limit == 0 {
            return viewable;
        }
        // Up to 30 suggestions of up to 5 items each: check a few at a time,
        // in order, until enough are shown.
        let mut checked = futures::stream::iter(ordered)
            .map(|suggestion| async move {
                let check = self.viewable(user, &suggestion).await;
                (suggestion, check)
            })
            .buffered(ACCESS_CHECKS_AT_ONCE);
        while let Some((suggestion, check)) = checked.next().await {
            match check {
                Ok(true) => {
                    viewable.shown.push(suggestion);
                    if viewable.shown.len() >= limit {
                        break;
                    }
                }
                Ok(false) => viewable.hidden += 1,
                Err(error) => {
                    viewable.unchecked += 1;
                    tracing::warn!(
                        ?error,
                        suggestion.id = %suggestion.id,
                        "could not check a suggestion's items; left out of the feed"
                    );
                }
            }
        }
        viewable
    }

    /// Count the person in for nightly generations, in `timezone`: at most once
    /// an hour per timezone, never failing the read.
    async fn count_in(&self, user: &MacroUserIdStr<'_>, timezone: chrono_tz::Tz) {
        let now = tokio::time::Instant::now();
        if self.readers.get(user.as_ref(), now) == Some(timezone) {
            return;
        }
        match self.audience.seen(user, timezone.name(), Utc::now()).await {
            Ok(()) => self.readers.put(user.as_ref(), timezone, now),
            Err(error) => tracing::warn!(?error, "could not record a suggestions reader"),
        }
    }

    /// The suggestion as stored after a write.
    async fn reread(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        match self
            .repo
            .suggestion(user, id)
            .await
            .map_err(SuggestionError::internal)?
        {
            Some(suggestion) => Ok(SuggestionWriteOutcome::applied(suggestion)),
            None => Err(SuggestionError::NotFound),
        }
    }
}

/// What the feed shows of one list.
#[derive(Default)]
struct Viewable {
    /// The suggestions shown, in order.
    shown: Vec<Suggestion>,
    /// Those about an item the person can no longer open.
    hidden: usize,
    /// Those whose items couldn't be checked.
    unchecked: usize,
}

/// Why a running suggestion's prompt and `sends` stay as they are.
const RUN_GOING: &str = "a run of this suggestion is going: its `prompt` and `sends` stay as the user \
     ran them until it settles; rewrite its other fields, or try again later";

/// Where `event` moves a suggestion in state `from`, as its lifecycle says; an
/// internal error where it doesn't apply, which the caller's checks rule out.
fn moved_by(
    from: SuggestionState,
    event: LifecycleEvent,
) -> Result<SuggestionState, SuggestionError> {
    lifecycle::transition(from, event).ok_or_else(|| {
        SuggestionError::Internal(rootcause::report!(
            "`{}` doesn't apply to a {} suggestion",
            event.as_ref(),
            from.as_ref()
        ))
    })
}

/// A problem when `content` changes the prompt or `sends` of `existing` while a
/// run of it is going.
fn run_going(existing: &Suggestion, content: &SuggestionContent, problems: &mut Vec<String>) {
    let SuggestionKind::Prompt { prompt, sends, .. } = &existing.kind else {
        return;
    };
    let changes = content.prompt.as_ref().is_some_and(|new| new != prompt) || content.sends != *sends;
    let going = existing.run.as_ref().is_some_and(|run| !run.state.is_settled());
    if changes && going {
        problems.push(RUN_GOING.to_owned());
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
        Written::RunGoing => Some(RUN_GOING.to_owned()),
    }
}

fn snapshot(content: &SuggestionContent) -> Option<serde_json::Value> {
    serde_json::to_value(content).ok()
}

/// A suggestion's draft, as the change log keeps it: `{"draft": target or null}`.
fn draft_snapshot(draft: Option<&Target>) -> Option<serde_json::Value> {
    let mut value = serde_json::Map::new();
    value.insert("draft".to_owned(), serde_json::to_value(draft).ok()?);
    Some(serde_json::Value::Object(value))
}

impl<Repo, Access, Drafts, Flags> SuggestionApi for SuggestionService<Repo, Access, Drafts, Flags>
where
    Repo: SuggestionRepo,
    Access: SuggestionAccess,
    Drafts: SuggestionDrafts,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(name = "suggestions.feed", skip_all, fields(
        suggestions.caller = tracing::field::Empty,
        suggestions.limit = limit,
        suggestions.open = tracing::field::Empty,
        suggestions.done = tracing::field::Empty,
        suggestions.hidden = tracing::field::Empty,
        suggestions.unchecked = tracing::field::Empty,
    ), err)]
    async fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        timezone: Option<chrono_tz::Tz>,
        limit: Option<usize>,
    ) -> Result<SuggestionFeed, SuggestionError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        if let Some(timezone) = timezone {
            self.count_in(user, timezone).await;
        }
        let done_since = Utc::now() - DONE_WITHIN;
        // Each suggestion comes with its latest run as stored: no session is
        // asked how a run is going.
        let shown: Vec<Suggestion> = self
            .repo
            .shown(user, done_since)
            .await
            .map_err(SuggestionError::internal)?;
        let (mut open, mut done): (Vec<Suggestion>, Vec<Suggestion>) = shown
            .into_iter()
            .partition(|suggestion| suggestion.state.is_open());
        open.sort_by(|a, b| {
            b.importance
                .cmp(&a.importance)
                .then(b.updated_at.cmp(&a.updated_at))
        });
        done.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let limit = limit.unwrap_or(usize::MAX);
        let open = self.viewable_first(user, open, limit).await;
        let done = self.viewable_first(user, done, limit).await;
        let span = tracing::Span::current();
        span.record("suggestions.open", open.shown.len());
        span.record("suggestions.done", done.shown.len());
        span.record("suggestions.hidden", open.hidden + done.hidden);
        span.record("suggestions.unchecked", open.unchecked + done.unchecked);
        Ok(SuggestionFeed {
            suggestions: open.shown,
            done: done.shown,
        })
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

    async fn kept(&self, generation: Uuid, session: Uuid) -> Result<u32, SuggestionError> {
        self.repo
            .kept_by(generation, session)
            .await
            .map_err(SuggestionError::internal)
    }

    #[tracing::instrument(name = "suggestions.accept", skip_all, fields(
        suggestion.id = %id,
        suggestions.caller = tracing::field::Empty,
    ), err)]
    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        id: Uuid,
        accept: Accept,
    ) -> Result<(), SuggestionError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        let suggestion = self
            .repo
            .suggestion(user, id)
            .await
            .map_err(SuggestionError::internal)?
            .ok_or(SuggestionError::NotFound)?;
        if let SuggestionKind::Prompt {
            prompt,
            run_mode: RunMode::Background,
            sends,
        } = &suggestion.kind
        {
            // Only the person, in the app, starts a run: anyone acting for
            // them at most takes the suggestion on, for them to run.
            if !(accept.by_person && caller == SuggestionCaller::User) {
                if suggestion.state == SuggestionState::Accepted {
                    return Ok(());
                }
                self.move_as_shown(
                    user,
                    &suggestion,
                    &lifecycle::sources(LifecycleEvent::TakeOn),
                    SuggestionState::Accepted,
                    accept,
                )
                .await?;
                tracing::info!(event = "suggestions.accepted", run = false);
                return Ok(());
            }
            return self
                .start_run(
                    user,
                    &suggestion,
                    &run_prompt(prompt, sends.as_deref()),
                    sends.as_deref(),
                    accept.shown_updated_at,
                )
                .await;
        }
        // Anything else the person acts on themself (opens the item, the
        // composer, the routine) is done when they do; accepting a done suggestion
        // again changes nothing.
        if suggestion.state == SuggestionState::Done {
            return Ok(());
        }
        // What the person opens is what they saw: a card read before the
        // suggestion was rewritten is read again first.
        self.move_as_shown(
            user,
            &suggestion,
            &lifecycle::sources(LifecycleEvent::Complete),
            SuggestionState::Done,
            accept,
        )
        .await?;
        tracing::info!(event = "suggestions.accepted", done = true);
        Ok(())
    }

    #[tracing::instrument(name = "suggestions.dismiss", skip_all, fields(
        suggestion.id = %id,
        suggestions.caller = tracing::field::Empty,
    ), err)]
    async fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        id: Uuid,
    ) -> Result<(), SuggestionError> {
        self.require_flag(user).await?;
        self.admit(caller).await?;
        let suggestion = self
            .repo
            .suggestion(user, id)
            .await
            .map_err(SuggestionError::internal)?;
        let suggestion = suggestion
            .filter(|suggestion| suggestion.state.is_open())
            .ok_or(SuggestionError::NotFound)?;
        // A routine suggestion and its suggestion are dismissed together, where
        // the suggestion is kept.
        if let SuggestionKind::Routine {
            routine_suggestion_id,
        } = suggestion.kind
        {
            let dismissed = self
                .routine_suggestions
                .dismiss_suggestion(user, routine_suggestion_id)
                .await
                .map_err(SuggestionError::Internal)?;
            if !dismissed {
                return Err(SuggestionError::NotFound);
            }
            tracing::info!(event = "suggestions.dismissed", kind = "routine");
            return Ok(());
        }
        let moved = self
            .repo
            .set_state(
                user,
                id,
                &lifecycle::sources(LifecycleEvent::Dismiss),
                SuggestionState::Dismissed,
                None,
                Utc::now(),
            )
            .await
            .map_err(SuggestionError::internal)?;
        if !moved {
            return Err(SuggestionError::NotFound);
        }
        self.stop_cancelled_run(&suggestion).await;
        tracing::info!(event = "suggestions.dismissed");
        Ok(())
    }

    #[tracing::instrument(name = "suggestions.review", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        suggestions.count = tracing::field::Empty,
    ), err)]
    async fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<SuggestionsReview, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let (suggestions, added) = tokio::try_join!(
            async {
                self.repo
                    .for_review(&session.user, REVIEW_CLOSED)
                    .await
                    .map_err(SuggestionError::internal)
            },
            async {
                self.repo
                    .added_in(session.generation)
                    .await
                    .map_err(SuggestionError::internal)
            },
        )?;
        let (mut open, mut closed): (Vec<Suggestion>, Vec<Suggestion>) = suggestions
            .into_iter()
            .partition(|suggestion| suggestion.state.is_open());
        open.sort_by(|a, b| b.importance.cmp(&a.importance));
        closed.sort_by(|a, b| b.state_changed_at.cmp(&a.state_changed_at));
        let open_count = u32::try_from(open.len()).unwrap_or(u32::MAX);
        open.append(&mut closed);
        tracing::Span::current().record("suggestions.count", open.len());
        Ok(SuggestionsReview {
            suggestions: open,
            open: open_count,
            open_limit: OPEN_LIMIT,
            new_left: NEW_PER_GENERATION.saturating_sub(added),
        })
    }

    #[tracing::instrument(name = "suggestions.suggest", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        suggestion.kind = request.kind.as_ref(),
        suggestion.id = tracing::field::Empty,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: NewSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
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
        let content = SuggestionContent {
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
            .map_err(SuggestionError::internal)?;
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
                .map_err(SuggestionError::internal)?;
            if let Some(problem) = written_problem(written) {
                return Ok(rejected(&span, vec![problem]));
            }
            span.record("suggestion.id", id.to_string());
            span.record("suggestion.outcome", "created");
            return self.reread(&user, id).await;
        };
        span.record("suggestion.id", existing.id.to_string());
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
                SuggestionKind::Prompt { run_mode, .. },
                super::model::NewKind::Prompt { run_mode: asked },
            ) => run_mode == asked,
            (
                SuggestionKind::Entity { action, .. },
                super::model::NewKind::Entity { action: asked },
            ) => action == asked,
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
        run_going(&existing, &content, &mut problems);
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        if existing.state == SuggestionState::Dismissed && reason.is_none() {
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
        let (action, event) = if existing.state.is_open() {
            (ChangeAction::Rewritten, LifecycleEvent::Rewrite)
        } else {
            (ChangeAction::Restored, LifecycleEvent::Restore)
        };
        let to = moved_by(existing.state, event)?;
        let change = Change {
            session: session.session,
            generation: session.generation,
            action,
            old: snapshot(&SuggestionContent::of(&existing)),
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
            .map_err(SuggestionError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("suggestion.outcome", action.as_ref());
        self.reread(&user, existing.id).await
    }

    #[tracing::instrument(name = "suggestions.rewrite", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        suggestion.id = %id,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteSuggestion,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .suggestion(&user, id)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Err(SuggestionError::NotFound);
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
            SuggestionKind::Prompt {
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
        let mut content = SuggestionContent::of(&existing);
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
        run_going(&existing, &content, &mut problems);
        if !problems.is_empty() {
            return Ok(rejected(&span, problems));
        }
        let to = moved_by(existing.state, LifecycleEvent::Rewrite)?;
        let change = Change {
            session: session.session,
            generation: session.generation,
            action: ChangeAction::Rewritten,
            old: snapshot(&SuggestionContent::of(&existing)),
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
                to,
                LIMITS,
                &change,
            )
            .await
            .map_err(SuggestionError::internal)?;
        if let Some(problem) = written_problem(written) {
            return Ok(rejected(&span, vec![problem]));
        }
        span.record("suggestion.outcome", "rewritten");
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "suggestions.retire", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.generation.trace_id = tracing::field::Empty,
        suggestion.id = %id,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireSuggestionRequest,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .suggestion(&user, id)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Err(SuggestionError::NotFound);
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
                SuggestionState::Retired.as_ref().to_owned(),
            )),
            reason,
            at: Utc::now(),
        };
        let moved = self
            .repo
            .set_state(
                &user,
                id,
                &lifecycle::sources(LifecycleEvent::Retire),
                SuggestionState::Retired,
                Some(&change),
                change.at,
            )
            .await
            .map_err(SuggestionError::internal)?;
        if !moved {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record("suggestion.outcome", "retired");
        self.stop_cancelled_run(&existing).await;
        self.reread(&user, id).await
    }

    #[tracing::instrument(name = "suggestions.attach_draft", skip_all, fields(
        agent.session.id = tracing::field::Empty,
        suggestion.generation.id = tracing::field::Empty,
        suggestion.id = %id,
        email.draft.id = %request.email_draft_id,
        suggestion.outcome = tracing::field::Empty,
        suggestion.problems = tracing::field::Empty,
    ), err)]
    async fn attach_draft(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: AttachDraft,
    ) -> Result<SuggestionWriteOutcome, SuggestionError> {
        let session = self.session(principal, correlation).await?;
        let span = tracing::Span::current();
        let user = session.user.clone();
        let Some(existing) = self
            .repo
            .suggestion(&user, id)
            .await
            .map_err(SuggestionError::internal)?
        else {
            return Err(SuggestionError::NotFound);
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
        let SuggestionKind::Entity {
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
            .map_err(SuggestionError::internal)?;
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
            span.record("suggestion.outcome", "unchanged");
            return Ok(SuggestionWriteOutcome::applied(existing));
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
            .map_err(SuggestionError::internal)?;
        if !attached {
            return Ok(rejected(
                &span,
                written_problem(Written::Conflict).into_iter().collect(),
            ));
        }
        span.record(
            "suggestion.outcome",
            if old.is_some() {
                "draft_replaced"
            } else {
                "draft_attached"
            },
        );
        self.reread(&user, id).await
    }
}

fn rejected(span: &tracing::Span, problems: Vec<String>) -> SuggestionWriteOutcome {
    span.record("suggestion.outcome", "rejected");
    span.record("suggestion.problems", problems.len());
    SuggestionWriteOutcome::rejected(problems)
}

/// What a background run is told: the suggestion's prompt, then that nobody is
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
