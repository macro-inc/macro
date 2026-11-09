//! What ideas need from outside, and the API they serve.

use std::future::Future;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use model_owner::CreationPrincipal;

use super::model::{
    Change, GenerationSession, GenerationTrigger, Idea, IdeaContent, IdeaError, IdeaReview,
    IdeaState, IdeaWriteOutcome, Ideas, NewKind, OpenTarget, ResolveReason, RetireIdea,
    RewriteIdea, SuggestIdea, Target,
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

    /// Every idea the person has, in any state.
    fn ideas(
        &self,
        user: &MacroUserIdStr<'_>,
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

    /// How many changes session `session` logged.
    fn kept_by(&self, session: Uuid) -> impl Future<Output = Result<u32, Self::Err>> + Send;

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

/// Ideas as the API serves them: the person's feed, and the tools hidden
/// generation sessions manage it with.
pub trait IdeaApi: Send + Sync + 'static {
    /// The person's open ideas they can still open every item of, best
    /// first. With their `timezone`, it also counts them in for nightly
    /// generations.
    fn feed(
        &self,
        user: &MacroUserIdStr<'static>,
        timezone: Option<chrono_tz::Tz>,
    ) -> impl Future<Output = Result<Ideas, IdeaError>> + Send;

    /// The person acts on a proposed idea.
    fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), IdeaError>> + Send;

    /// The person isn't interested in an open idea.
    fn dismiss(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> impl Future<Output = Result<(), IdeaError>> + Send;

    /// What an ideas session of a generation started by `trigger` is told,
    /// for a person in `timezone`.
    fn brief(&self, trigger: GenerationTrigger, timezone: chrono_tz::Tz) -> String;

    /// How many changes ideas session `session` made.
    fn kept(&self, session: Uuid) -> impl Future<Output = Result<u32, IdeaError>> + Send;

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
}

/// Ends the open ideas an event settles.
pub trait ResolveIdeas: Send + Sync + 'static {
    /// Resolve the open ideas `event` settles; resolving twice is a no-op.
    fn resolve(
        &self,
        event: &ResolutionEvent,
    ) -> impl Future<Output = Result<Resolved, IdeaError>> + Send;
}
