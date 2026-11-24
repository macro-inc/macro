//! What the feedback service needs from storage and from the crates that own
//! the rated responses, and what it offers the inbound adapters.

use std::future::Future;

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use super::model::{
    AppendOutcome, ExportCursor, ExportLimit, ExportPage, FeedbackContainer, FeedbackError,
    FeedbackEvent, FeedbackState, FeedbackWrite, MyFeedback, RateRequest, RatedResponse,
    RetractRequest, SubjectKind,
};

/// The feedback use cases, as the HTTP adapter calls them.
pub trait FeedbackApi: Send + Sync + 'static {
    /// Rate a response, or change the caller's rating of it.
    fn rate(
        &self,
        response: RatedResponse,
        request: RateRequest,
    ) -> impl Future<Output = Result<FeedbackState, FeedbackError>> + Send;

    /// Retract the caller's rating of a response.
    fn retract(
        &self,
        response: RatedResponse,
        request: RetractRequest,
    ) -> impl Future<Output = Result<(), FeedbackError>> + Send;

    /// The caller's current ratings of responses in one container.
    fn mine(
        &self,
        container: FeedbackContainer,
    ) -> impl Future<Output = Result<Vec<MyFeedback>, FeedbackError>> + Send;

    /// Every stored row after `after`, for evals. Internal callers only; the
    /// adapter admits no one else.
    fn export(
        &self,
        after: Option<ExportCursor>,
        limit: ExportLimit,
    ) -> impl Future<Output = Result<ExportPage, FeedbackError>> + Send;
}

/// The append-only ratings table.
pub trait FeedbackRepo: Send + Sync + 'static {
    /// Append `write` unless it changes nothing, one writer per person and
    /// response at a time:
    /// - a row with `write.id` already stored for the same person and
    ///   response is a retry: [`AppendOutcome::Replayed`] with the current
    ///   state, nothing written;
    /// - a row with `write.id` stored for anything else: [`AppendOutcome::IdTaken`];
    /// - the newest row's rating and note equal the write's (no row counts as
    ///   no rating and no note): [`AppendOutcome::Unchanged`];
    /// - otherwise the row is written: [`AppendOutcome::Created`].
    fn append_if_changed(
        &self,
        write: &FeedbackWrite,
    ) -> impl Future<Output = Result<AppendOutcome, Report>> + Send;

    /// One person's current, unretracted ratings in these containers.
    fn current_in_containers(
        &self,
        user: &MacroUserIdStr<'static>,
        kind: SubjectKind,
        container_ids: &[String],
    ) -> impl Future<Output = Result<Vec<MyFeedback>, Report>> + Send;

    /// Up to `limit` rows after `after`, in `(created_at, id)` order.
    fn events_after(
        &self,
        after: Option<ExportCursor>,
        limit: ExportLimit,
    ) -> impl Future<Output = Result<Vec<FeedbackEvent>, Report>> + Send;
}

/// What a session says about the agent running it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionFacts {
    /// The bot running the session.
    pub bot_id: BotId,
    /// Its harness slug.
    pub harness: String,
    /// Its current model slug.
    pub model: String,
}

/// Agent sessions, read for the context recorded with a rating.
pub trait AgentSessions: Send + Sync + 'static {
    /// The session's facts, or `None` when there is no such session.
    fn session(
        &self,
        id: AgentSessionId,
    ) -> impl Future<Output = Result<Option<SessionFacts>, Report>> + Send;
}

/// What a routine run says about what produced it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFacts {
    /// The agent session the run produced, when it ran one.
    pub agent_session_id: Option<AgentSessionId>,
}

/// Routine runs.
pub trait RoutineRuns: Send + Sync + 'static {
    /// The run `run_id` of routine `routine_id`, or `None` when that routine
    /// has no such run.
    fn run(
        &self,
        routine_id: Uuid,
        run_id: Uuid,
    ) -> impl Future<Output = Result<Option<RunFacts>, Report>> + Send;
}

/// Which accounts are agent teammates.
pub trait AgentAccounts: Send + Sync + 'static {
    /// Whether `user` is an agent account (`"User"."isAgent"`); `false` for an
    /// unknown account.
    fn is_agent_account(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
}

/// What a suggestion says about the agent that made it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuggestionFacts {
    /// The generation session that proposed or last changed it.
    pub agent_session_id: Option<AgentSessionId>,
}

/// The person's suggestions, which only they can see.
pub trait Suggestions: Send + Sync + 'static {
    /// `user`'s suggestion `id`, or `None` when they have no such suggestion.
    fn suggestion(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<SuggestionFacts>, Report>> + Send;
}
