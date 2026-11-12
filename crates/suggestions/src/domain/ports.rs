//! What suggestions need from outside, and the API they serve.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::model::{
    Accept, AttachDraft, Change, GenerationSession, GenerationTrigger, NewKind, NewSuggestion,
    OpenTarget, ResolveReason, RetireSuggestionRequest, RewriteSuggestion, RunSettled,
    RunStartError, SessionReadError, SessionState, StoredRun, Suggestion, SuggestionContent,
    SuggestionError, SuggestionFeed, SuggestionState, SuggestionWriteOutcome, SuggestionsReview,
    Target,
};
use super::resolution::{ResolutionEvent, Resolved};

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

    /// Start run `run` of the person's background prompt suggestion: one that is
    /// proposed, or accepted with no run going and none finished, and last
    /// changed at `shown_updated_at`. The suggestion becomes accepted. False when
    /// it can't run now.
    fn start_run(
        &self,
        run: &StoredRun,
        shown_updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The latest run of each of the person's suggestions in `suggestions` that has one.
    fn latest_runs(
        &self,
        user: &MacroUserIdStr<'_>,
        suggestions: &[Uuid],
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

    /// Settle run `session` as `settled`; a finished one makes its suggestion done,
    /// if still accepted, and adds `produced` to it. False when it was
    /// settled already.
    fn settle_run(
        &self,
        session: Uuid,
        settled: RunSettled,
        produced: &[Target],
        at: DateTime<Utc>,
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
    /// `limits`.
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
    /// logging `change` when given; whether it moved.
    fn set_state(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        from: &[SuggestionState],
        to: SuggestionState,
        change: Option<&Change>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Make `draft` the draft of the person's suggestion `id` while it is open,
    /// replacing any draft it had, logging `change`; whether it was open.
    fn set_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        draft: &Target,
        change: &Change,
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
    /// Whether `session` runs a suggestion that says it sends nothing.
    async fn sends_nothing(&self, session: Uuid) -> Result<bool, rootcause::Report>;
}

/// The person's drafts, as the domain that keeps them sees them.
pub trait SuggestionDrafts: Send + Sync + 'static {
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

    /// Delete `run`'s session, one that never took its prompt.
    async fn discard(&self, run: &StoredRun) -> Result<(), rootcause::Report>;
}

/// Suggestions as the API serves them: the person's feed, and the tools hidden
/// generation sessions manage it with.
pub trait SuggestionApi: Send + Sync + 'static {
    /// The person's open suggestions they can still open every item of, best
    /// first. With their `timezone`, it also counts them in for nightly
    /// generations.
    fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Option<chrono_tz::Tz>,
    ) -> impl Future<Output = Result<SuggestionFeed, SuggestionError>> + Send;

    /// The person acts on a suggestion. A background prompt suggestion starts a run
    /// (one whose last run failed runs again) when the person themself
    /// accepts it as they saw it; any other is done.
    fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        accept: Accept,
    ) -> impl Future<Output = Result<(), SuggestionError>> + Send;

    /// The person isn't interested in an open suggestion.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
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

    /// Settle the runs whose sessions finished: a finished one makes its
    /// suggestion done with what it produced. How many it settled.
    fn settle_runs(&self) -> impl Future<Output = Result<usize, SuggestionError>> + Send;

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
