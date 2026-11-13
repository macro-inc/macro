//! What suggestions need from outside, and the API they serve.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::model::{
    Accept, AttachDraft, Change, GenerationSession, GenerationTrigger, NewKind, NewSuggestion,
    OpenTarget, ResolveReason, RetireSuggestionRequest, RewriteSuggestion, RunStartError,
    SessionReadError, SessionState, StoredRun, Suggestion, SuggestionCaller, SuggestionContent,
    SuggestionError, SuggestionFeed, SuggestionState, SuggestionWriteOutcome, SuggestionsReview,
    Target, Waiting,
};
use super::resolution::{ResolutionEvent, Resolved};
use super::run::{Advanced, RunState, SessionEvent};

/// Limits a write must stay within, checked where it is stored so two
/// writes at once can't pass them together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Most open suggestions a person may have.
    pub open: u32,
    /// Most suggestions one generation may add or bring back.
    pub new_per_generation: u32,
}

/// How a write that adds an open suggestion went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Written {
    /// Stored.
    Applied,
    /// The person has [`Limits::open`] open suggestions already.
    OverOpenLimit,
    /// The generation added [`Limits::new_per_generation`] already.
    OverNewLimit,
    /// Another write took the suggestion first: its dedup key is taken, or its
    /// state moved on.
    Conflict,
    /// Its prompt or `sends` would change while a run of it is unsettled.
    RunGoing,
}

/// Suggestions, their items and the change log, in storage.
pub trait SuggestionRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The person's open suggestions, and those done since `done_since`.
    fn shown(
        &self,
        user: &MacroUserIdStr<'_>,
        done_since: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<Suggestion>, Self::Err>> + Send;

    /// The person's open suggestions, and the `closed` most recently closed.
    fn for_review(
        &self,
        user: &MacroUserIdStr<'_>,
        closed: u32,
    ) -> impl Future<Output = Result<Vec<Suggestion>, Self::Err>> + Send;

    /// The person's suggestion `id`.
    fn suggestion(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Suggestion>, Self::Err>> + Send;

    /// The person's suggestion with `dedup_key`.
    fn by_dedup_key(
        &self,
        user: &MacroUserIdStr<'_>,
        dedup_key: &str,
    ) -> impl Future<Output = Result<Option<Suggestion>, Self::Err>> + Send;

    /// How many suggestions generation `generation` added or brought back.
    fn added_in(&self, generation: Uuid) -> impl Future<Output = Result<u32, Self::Err>> + Send;

    /// How many changes session `session` of generation `generation`
    /// logged.
    fn kept_by(
        &self,
        generation: Uuid,
        session: Uuid,
    ) -> impl Future<Output = Result<u32, Self::Err>> + Send;

    /// Start run `run` of the person's background prompt suggestion: one that may
    /// start a run ([`LifecycleEvent::StartRun`](super::lifecycle::LifecycleEvent::StartRun)),
    /// has no unsettled run, and last changed at `shown_updated_at`. The
    /// suggestion becomes accepted, and the run is stored as `run` says
    /// (starting, with its `sends`). False when it can't run now.
    fn start_run(
        &self,
        run: &StoredRun,
        shown_updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Run `session`, if it is one.
    fn run(&self, session: Uuid) -> impl Future<Output = Result<Option<StoredRun>, Self::Err>> + Send;

    /// Unsettled runs nobody holds at `now`, least recently checked first,
    /// at most `limit`.
    fn runs_to_check(
        &self,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StoredRun>, Self::Err>> + Send;

    /// Hold unsettled run `session` until `until`, unless someone holds it at
    /// `now`: it is checked at `now`, and nobody else acts on it meanwhile.
    /// The run as it is, when held.
    fn claim_run(
        &self,
        session: Uuid,
        now: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<StoredRun>, Self::Err>> + Send;

    /// Let go of run `session`, held until `until`.
    fn release_run(
        &self,
        session: Uuid,
        until: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Move `run` to `to`, entered at `changed_at`, if it is still as read
    /// (its state and when it entered it); settled at `now` when `to` is.
    /// A finished run adds `produced` to its suggestion (once each) and makes
    /// it done if it is still accepted. Lets go of the run. Whether it moved.
    fn move_run(
        &self,
        run: &StoredRun,
        to: RunState,
        changed_at: DateTime<Utc>,
        produced: &[Target],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Add a proposed suggestion `id` with `content` for the person, within
    /// `limits`, logging `change`.
    fn create(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        kind: &NewKind,
        content: &SuggestionContent,
        limits: Limits,
        change: &Change,
    ) -> impl Future<Output = Result<Written, Self::Err>> + Send;

    /// Replace suggestion `id`'s content and move it from state `from` to `to`,
    /// logging `change`. Moving it from closed to open stays within
    /// `limits`. Its prompt and `sends` don't change while a run of it
    /// is unsettled ([`Written::RunGoing`]).
    #[expect(clippy::too_many_arguments, reason = "one write, all of its parts")]
    fn replace(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        content: &SuggestionContent,
        from: SuggestionState,
        to: SuggestionState,
        limits: Limits,
        change: &Change,
    ) -> impl Future<Output = Result<Written, Self::Err>> + Send;

    /// Move the person's suggestion `id` to `to` when it is in one of `from`,
    /// logging `change` when given; whether it moved. Moving it to a state that
    /// cancels its run ([`cancels_run`](super::lifecycle::cancels_run)) cancels
    /// its unsettled run in the same write.
    fn set_state(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[SuggestionState],
        to: SuggestionState,
        change: Option<&Change>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Make `draft`, previewed as `preview`, the draft of the person's suggestion
    /// `id` while it is open, replacing any draft it had, logging `change`;
    /// whether it was open.
    fn set_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        draft: &Target,
        preview: Option<&str>,
        change: &Change,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Bring back the person's suggestion `id` if they dismissed it at
    /// `dismissed_since` or later, as proposed; a run its dismissal cancelled
    /// stays cancelled. Whether it came back.
    fn undismiss(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        dismissed_since: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Move the person's suggestion `id` to `to` when it is in one of `from` and
    /// still last changed at `shown_updated_at`: acting on it as the caller
    /// saw it. Whether it moved.
    fn set_state_as_shown(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[SuggestionState],
        to: SuggestionState,
        shown_updated_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Every open suggestion about the item, once per target naming it.
    fn open_about(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> impl Future<Output = Result<Vec<OpenTarget>, Self::Err>> + Send;

    /// Resolve the person's suggestion `id` for `reason` if it is still open;
    /// whether it moved. Its unsettled run is cancelled in the same write.
    fn resolve(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        reason: ResolveReason,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Whether the person can open an item.
pub trait SuggestionAccess: Send + Sync + 'static {
    /// The error type returned by access checks.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether the person can at least view `target`'s item.
    fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Whether `part` is one of `target`'s item's own parts, such as a
    /// message of its channel. Parts never move, so writes check this once.
    fn is_part_of(
        &self,
        target: &Target,
        part: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Whether a session is a background run that may send nothing: its
/// credential is then minted unable to send or post. Object-safe, for the
/// harness's credential minting.
#[async_trait::async_trait]
pub trait RunScopes: Send + Sync + 'static {
    /// Whether `session` is a run whose `sends`, as the suggestion said when
    /// it started, is nothing.
    async fn sends_nothing(&self, session: Uuid) -> Result<bool, rootcause::Report>;
}

/// The person's drafts, as the domain that keeps them sees them.
pub trait SuggestionDrafts: Send + Sync + 'static {
    /// The error type returned by draft reads.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Email draft `draft` when it is an unsent draft in one of the person's
    /// own inboxes; `None` for anything else.
    fn email_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> impl Future<Output = Result<Option<FoundDraft>, Self::Err>> + Send;
}

/// An email draft a reply suggestion may carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundDraft {
    /// The thread it is in.
    pub thread: Uuid,
    /// The start of its plain text, when it has any.
    pub preview: Option<String>,
}

/// What a reply suggestion's item waits on the person for. Object-safe: the
/// harness hands in one adapter over email and channels.
#[async_trait::async_trait]
pub trait ReplyWaits: Send + Sync + 'static {
    /// For an email thread, its newest message; for a channel message, that
    /// message: when it came and its sender, unless the person sent it. `None`
    /// for any other item, or one with no such message.
    async fn waiting(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<Option<Waiting>, rootcause::Report>;
}

/// The agent session behind a code-mode request. Object-safe, so one
/// adapter serves every crate that asks.
#[async_trait::async_trait]
pub trait RequestSessions: Send + Sync + 'static {
    /// The session whose code-mode invocation `correlation` names.
    async fn session_of(&self, correlation: Uuid) -> Result<Option<Uuid>, rootcause::Report>;
}

/// The open hidden sessions of generations. Object-safe, so one adapter
/// serves every crate whose tools a generation session calls.
#[async_trait::async_trait]
pub trait GenerationSessions: Send + Sync + 'static {
    /// Session `session`, if it is a generation's and still open.
    async fn open_session(
        &self,
        session: Uuid,
    ) -> Result<Option<GenerationSession>, rootcause::Report>;
}

/// Who gets a nightly generation. Object-safe, for the same reason.
#[async_trait::async_trait]
pub trait SuggestionAudience: Send + Sync + 'static {
    /// The person opened their suggestions at `now`, in IANA zone `timezone`.
    async fn seen(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<(), rootcause::Report>;
}

/// Routine suggestions, which a routine suggestion shows. Object-safe: the
/// harness hands in the routine suggestions service.
#[async_trait::async_trait]
pub trait RoutineSuggestionDismissal: Send + Sync + 'static {
    /// The person isn't interested in routine suggestion `suggestion`: it
    /// and its routine suggestion are dismissed together. Whether it was theirs.
    async fn dismiss_suggestion(
        &self,
        user: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<bool, rootcause::Report>;
}

/// The hidden agent sessions that run background prompt suggestions. Object-safe:
/// the harness hands in its session client.
#[async_trait::async_trait]
pub trait RunSessions: Send + Sync + 'static {
    /// Open `run`'s hidden session as its person, billed as their agent
    /// usage, and send it `prompt` once. A prompt refused outright deletes
    /// the session it opened.
    async fn start(&self, run: &StoredRun, prompt: &str) -> Result<(), RunStartError>;

    /// Where `run`'s session is; [`SessionReadError::Missing`] only when it
    /// is known not to exist.
    async fn state(&self, run: &StoredRun) -> Result<SessionState, SessionReadError>;

    /// What `run`'s session made, besides the session itself.
    async fn produced(&self, run: &StoredRun) -> Result<Vec<Target>, rootcause::Report>;

    /// Ask `run`'s session to stop its turn. Its stopping is seen later,
    /// from its events or a read.
    async fn stop(&self, run: &StoredRun) -> Result<(), rootcause::Report>;

    /// Delete `run`'s session: nothing of it runs after.
    async fn delete(&self, run: &StoredRun) -> Result<(), rootcause::Report>;
}

/// Suggestions as the API serves them: the person's feed, which they and their
/// own agent read and act on, and the tools hidden generation sessions
/// manage it with.
pub trait SuggestionApi: Send + Sync + 'static {
    /// The person's open suggestions they can still open every item of, best
    /// first, and those done in the last day, most recently first; at most
    /// `limit` of each. With their `timezone`, it also counts them in for
    /// nightly generations. `caller` is the person or their own agent; a
    /// generation session is refused.
    fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        timezone: Option<chrono_tz::Tz>,
        limit: Option<usize>,
    ) -> impl Future<Output = Result<SuggestionFeed, SuggestionError>> + Send;

    /// The person, or someone acting for them, acts on a suggestion. A
    /// background prompt suggestion starts a run (one whose last run failed runs
    /// again) only when the person themself accepts it in the app as they
    /// saw it; anyone acting for them only takes it on. Any other is done.
    fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        id: Uuid,
        accept: Accept,
    ) -> impl Future<Output = Result<(), SuggestionError>> + Send;

    /// The person, or their own agent, isn't interested in an open suggestion.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        id: Uuid,
    ) -> impl Future<Output = Result<(), SuggestionError>> + Send;

    /// The person, or their own agent, takes back dismissing a suggestion, within
    /// [`RESTORE_WITHIN`](super::service::RESTORE_WITHIN) of it: it is proposed
    /// again, and a run the dismissal cancelled stays cancelled.
    fn restore(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: SuggestionCaller,
        id: Uuid,
    ) -> impl Future<Output = Result<(), SuggestionError>> + Send;

    /// What a suggestions session of a generation started by `trigger` is told,
    /// for a person in `timezone`.
    fn brief(&self, trigger: GenerationTrigger, timezone: chrono_tz::Tz) -> String;

    /// How many changes suggestions session `session` of generation `generation`
    /// made.
    fn kept(
        &self,
        generation: Uuid,
        session: Uuid,
    ) -> impl Future<Output = Result<u32, SuggestionError>> + Send;

    /// Every suggestion of the person's, for the suggestions session the request
    /// `correlation` names.
    fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> impl Future<Output = Result<SuggestionsReview, SuggestionError>> + Send;

    /// Add a suggestion, or a new version of the one with its dedup key.
    fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: NewSuggestion,
    ) -> impl Future<Output = Result<SuggestionWriteOutcome, SuggestionError>> + Send;

    /// Change an open suggestion's words, importance, categories or items.
    fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteSuggestion,
    ) -> impl Future<Output = Result<SuggestionWriteOutcome, SuggestionError>> + Send;

    /// Retire an open suggestion that no longer matters.
    fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireSuggestionRequest,
    ) -> impl Future<Output = Result<SuggestionWriteOutcome, SuggestionError>> + Send;

    /// Make a reply draft the session wrote the draft of an open reply suggestion,
    /// replacing the one it had.
    fn attach_draft(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: AttachDraft,
    ) -> impl Future<Output = Result<SuggestionWriteOutcome, SuggestionError>> + Send;
}

/// Ends the open suggestions an event settles.
pub trait ResolveSuggestions: Send + Sync + 'static {
    /// Resolve the open suggestions `event` settles; resolving twice is a no-op.
    fn resolve(
        &self,
        event: &ResolutionEvent,
    ) -> impl Future<Output = Result<Resolved, SuggestionError>> + Send;
}

/// Moves background runs along as their sessions go.
pub trait SuggestionRuns: Send + Sync + 'static {
    /// Apply what a session said about itself to its run, if it is one.
    fn on_session_event(
        &self,
        event: SessionEvent,
    ) -> impl Future<Output = Result<RunEventOutcome, SuggestionError>> + Send;

    /// Check the runs nobody holds, least recently checked first: read each
    /// one's session and move it on, giving up the ones over their time. One
    /// run failing never stops the others.
    fn reconcile_runs(&self) -> impl Future<Output = Result<RunsReconciled, SuggestionError>> + Send;
}

/// A shared service moves runs as it does.
impl<T: SuggestionRuns> SuggestionRuns for std::sync::Arc<T> {
    fn on_session_event(
        &self,
        event: SessionEvent,
    ) -> impl Future<Output = Result<RunEventOutcome, SuggestionError>> + Send {
        T::on_session_event(self, event)
    }

    fn reconcile_runs(&self) -> impl Future<Output = Result<RunsReconciled, SuggestionError>> + Send {
        T::reconcile_runs(self)
    }
}

/// How a session's event went for runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEventOutcome {
    /// The session runs no unsettled suggestion run.
    Ignored,
    /// Someone else holds the run just now; try again shortly.
    Busy,
    /// Applied to the run.
    Applied(Advanced),
}

/// What one reconcile pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RunsReconciled {
    /// Runs it looked at.
    pub checked: usize,
    /// Runs it moved (settled ones included).
    pub moved: usize,
    /// Runs it settled.
    pub settled: usize,
    /// Runs it couldn't check, for an error.
    pub failed: usize,
}
