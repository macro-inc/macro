//! What ideas need from outside, and the API they serve.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::model::{
    Accept, AttachDraft, Change, GenerationSession, GenerationTrigger, Idea, IdeaCaller,
    IdeaContent, IdeaError, IdeaReview, IdeaState, IdeaWriteOutcome, Ideas, NewKind, OpenTarget,
    ResolveReason, RetireIdea, RewriteIdea, RunSettled, RunStartError, SessionReadError,
    SessionState, StoredRun, SuggestIdea, Target,
};
use super::resolution::{ResolutionEvent, Resolved};

/// Limits a write must stay within, checked where it is stored so two
/// writes at once can't pass them together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Most open ideas a person may have.
    pub open: u32,
    /// Most ideas one generation may add or bring back.
    pub new_per_generation: u32,
}

/// How a write that adds an open idea went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Written {
    /// Stored.
    Applied,
    /// The person has [`Limits::open`] open ideas already.
    OverOpenLimit,
    /// The generation added [`Limits::new_per_generation`] already.
    OverNewLimit,
    /// Another write took the idea first: its dedup key is taken, or its
    /// state moved on.
    Conflict,
}

/// Ideas, their items and the change log, in storage.
pub trait IdeaRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The person's open ideas, and those done since `done_since`.
    fn shown(
        &self,
        user: &MacroUserIdStr<'_>,
        done_since: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<Idea>, Self::Err>> + Send;

    /// The person's open ideas, and the `closed` most recently closed.
    fn for_review(
        &self,
        user: &MacroUserIdStr<'_>,
        closed: u32,
    ) -> impl Future<Output = Result<Vec<Idea>, Self::Err>> + Send;

    /// The person's idea `id`.
    fn idea(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Idea>, Self::Err>> + Send;

    /// The person's idea with `dedup_key`.
    fn by_dedup_key(
        &self,
        user: &MacroUserIdStr<'_>,
        dedup_key: &str,
    ) -> impl Future<Output = Result<Option<Idea>, Self::Err>> + Send;

    /// How many ideas generation `generation` added or brought back.
    fn added_in(&self, generation: Uuid) -> impl Future<Output = Result<u32, Self::Err>> + Send;

    /// How many changes session `session` of generation `generation`
    /// logged.
    fn kept_by(
        &self,
        generation: Uuid,
        session: Uuid,
    ) -> impl Future<Output = Result<u32, Self::Err>> + Send;

    /// Start run `run` of the person's background prompt idea: one that is
    /// proposed, or accepted with no run going and none finished, and last
    /// changed at `shown_updated_at`. The idea becomes accepted. False when
    /// it can't run now.
    fn start_run(
        &self,
        run: &StoredRun,
        shown_updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The latest run of each of the person's ideas in `ideas` that has one.
    fn latest_runs(
        &self,
        user: &MacroUserIdStr<'_>,
        ideas: &[Uuid],
    ) -> impl Future<Output = Result<Vec<StoredRun>, Self::Err>> + Send;

    /// Runs not settled yet, least recently checked first, at most `limit`.
    fn unsettled_runs(
        &self,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StoredRun>, Self::Err>> + Send;

    /// Run `session` was checked at `at`: it goes to the back of
    /// [`Self::unsettled_runs`].
    fn checked_run(
        &self,
        session: Uuid,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Settle run `session` as `settled`; a finished one makes its idea done,
    /// if still accepted, and adds `produced` to it. False when it was
    /// settled already.
    fn settle_run(
        &self,
        session: Uuid,
        settled: RunSettled,
        produced: &[Target],
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Add a proposed idea `id` with `content` for the person, within
    /// `limits`, logging `change`.
    fn create(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        kind: &NewKind,
        content: &IdeaContent,
        limits: Limits,
        change: &Change,
    ) -> impl Future<Output = Result<Written, Self::Err>> + Send;

    /// Replace idea `id`'s content and move it from state `from` to `to`,
    /// logging `change`. Moving it from closed to open stays within
    /// `limits`.
    #[expect(clippy::too_many_arguments, reason = "one write, all of its parts")]
    fn replace(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        content: &IdeaContent,
        from: IdeaState,
        to: IdeaState,
        limits: Limits,
        change: &Change,
    ) -> impl Future<Output = Result<Written, Self::Err>> + Send;

    /// Move the person's idea `id` to `to` when it is in one of `from`,
    /// logging `change` when given; whether it moved.
    fn set_state(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[IdeaState],
        to: IdeaState,
        change: Option<&Change>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Make `draft` the draft of the person's idea `id` while it is open,
    /// replacing any draft it had, logging `change`; whether it was open.
    fn set_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        draft: &Target,
        change: &Change,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Move the person's idea `id` to `to` when it is in one of `from` and
    /// still last changed at `shown_updated_at`: acting on it as the caller
    /// saw it. Whether it moved.
    fn set_state_as_shown(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[IdeaState],
        to: IdeaState,
        shown_updated_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Every open idea about the item, once per target naming it.
    fn open_about(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> impl Future<Output = Result<Vec<OpenTarget>, Self::Err>> + Send;

    /// Resolve the person's idea `id` for `reason` if it is still open;
    /// whether it moved.
    fn resolve(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        reason: ResolveReason,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Whether the person can open an item.
pub trait IdeaAccess: Send + Sync + 'static {
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
    /// Whether `session` runs an idea that says it sends nothing.
    async fn sends_nothing(&self, session: Uuid) -> Result<bool, rootcause::Report>;
}

/// The person's drafts, as the domain that keeps them sees them.
pub trait IdeaDrafts: Send + Sync + 'static {
    /// The error type returned by draft reads.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The thread of email draft `draft` when it is an unsent draft in one
    /// of the person's own inboxes; `None` for anything else.
    fn email_draft_thread(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
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

/// Routine suggestions, which a routine idea shows. Object-safe: the
/// harness hands in the routine suggestions service.
#[async_trait::async_trait]
pub trait RoutineSuggestionDismissal: Send + Sync + 'static {
    /// The person isn't interested in routine suggestion `suggestion`: it
    /// and its routine idea are dismissed together. Whether it was theirs.
    async fn dismiss_suggestion(
        &self,
        user: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<bool, rootcause::Report>;
}

/// The hidden agent sessions that run background prompt ideas. Object-safe:
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

    /// Delete `run`'s session, one that never took its prompt.
    async fn discard(&self, run: &StoredRun) -> Result<(), rootcause::Report>;
}

/// Ideas as the API serves them: the person's feed, which they and their
/// own agent read and act on, and the tools hidden generation sessions
/// manage it with.
pub trait IdeaApi: Send + Sync + 'static {
    /// The person's open ideas they can still open every item of, best
    /// first. With their `timezone`, it also counts them in for nightly
    /// generations. `caller` is the person or their own agent; a
    /// generation session is refused.
    fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        timezone: Option<chrono_tz::Tz>,
    ) -> impl Future<Output = Result<Ideas, IdeaError>> + Send;

    /// The person, or someone acting for them, acts on an idea. A
    /// background prompt idea starts a run (one whose last run failed runs
    /// again) only when the person themself accepts it in the app as they
    /// saw it; anyone acting for them only takes it on. Any other is done.
    fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        id: Uuid,
        accept: Accept,
    ) -> impl Future<Output = Result<(), IdeaError>> + Send;

    /// The person, or their own agent, isn't interested in an open idea.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: IdeaCaller,
        id: Uuid,
    ) -> impl Future<Output = Result<(), IdeaError>> + Send;

    /// What an ideas session of a generation started by `trigger` is told,
    /// for a person in `timezone`.
    fn brief(&self, trigger: GenerationTrigger, timezone: chrono_tz::Tz) -> String;

    /// How many changes ideas session `session` of generation `generation`
    /// made.
    fn kept(
        &self,
        generation: Uuid,
        session: Uuid,
    ) -> impl Future<Output = Result<u32, IdeaError>> + Send;

    /// Settle the runs whose sessions finished: a finished one makes its
    /// idea done with what it produced. How many it settled.
    fn settle_runs(&self) -> impl Future<Output = Result<usize, IdeaError>> + Send;

    /// Every idea of the person's, for the ideas session the request
    /// `correlation` names.
    fn review(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> impl Future<Output = Result<IdeaReview, IdeaError>> + Send;

    /// Add an idea, or a new version of the one with its dedup key.
    fn suggest(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        request: SuggestIdea,
    ) -> impl Future<Output = Result<IdeaWriteOutcome, IdeaError>> + Send;

    /// Change an open idea's words, importance, categories or items.
    fn rewrite(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RewriteIdea,
    ) -> impl Future<Output = Result<IdeaWriteOutcome, IdeaError>> + Send;

    /// Retire an open idea that no longer matters.
    fn retire(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: RetireIdea,
    ) -> impl Future<Output = Result<IdeaWriteOutcome, IdeaError>> + Send;

    /// Make a reply draft the session wrote the draft of an open reply idea,
    /// replacing the one it had.
    fn attach_draft(
        &self,
        principal: &CreationPrincipal,
        correlation: Option<Uuid>,
        id: Uuid,
        request: AttachDraft,
    ) -> impl Future<Output = Result<IdeaWriteOutcome, IdeaError>> + Send;
}

/// Ends the open ideas an event settles.
pub trait ResolveIdeas: Send + Sync + 'static {
    /// Resolve the open ideas `event` settles; resolving twice is a no-op.
    fn resolve(
        &self,
        event: &ResolutionEvent,
    ) -> impl Future<Output = Result<Resolved, IdeaError>> + Send;
}
