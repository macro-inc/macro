//! What a rating is, what it rates, and what is recorded with it.

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use messages::domain::service::MessageView;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The PostHog flag that admits a person to rating agent responses. A rollout
/// gate only: it grants no access to anything rated.
pub const AGENT_RESPONSE_FEEDBACK_FLAG: &str = "enable-agent-response-feedback";

/// The longest note, in characters (as Postgres `char_length` counts them).
pub const NOTE_MAX_CHARS: usize = 4000;

/// Thumbs up or down.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Rating {
    /// A good response.
    Up,
    /// A bad response.
    Down,
}

/// Where the person saw the response; the only context the client reports.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Surface {
    /// The Agents view.
    AgentsView,
    /// An agent session opened as a block (split or tab).
    AgentBlock,
    /// A channel, DM or discussion timeline.
    MessageTimeline,
    /// A message thread.
    MessageThread,
    /// A routine run's detail.
    RoutineRun,
}

/// What kind of response was rated.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SubjectKind {
    /// An agent's reply in one turn of an agent session.
    AgentSessionTurn,
    /// An agent's message in a channel, DM, thread or discussion.
    Message,
    /// One run of a routine.
    RoutineRun,
}

/// What produced the response.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentKind {
    /// A first-party bot such as `@macro`.
    SystemBot,
    /// A bot a person or team owns.
    OwnedBot,
    /// An agent teammate, posting as its own account.
    Teammate,
}

impl AgentKind {
    /// The kind of a bot, by whether it is one of the first-party bots.
    pub fn of_bot(bot: BotId) -> Self {
        if bot_id::is_system_bot(bot) {
            Self::SystemBot
        } else {
            Self::OwnedBot
        }
    }
}

/// One rated response, by what it is.
#[derive(Debug, Clone, PartialEq)]
pub enum FeedbackSubject {
    /// The agent's reply in `turn` of a session.
    AgentSessionTurn {
        /// The session.
        session_id: AgentSessionId,
        /// The fold's turn index, which is stable for a session's log.
        turn: u32,
    },
    /// An agent's message.
    Message {
        /// Where the message was posted.
        parent: MessageParent,
        /// The message.
        message_id: Uuid,
    },
    /// One run of a routine.
    RoutineRun {
        /// The routine (scheduled action).
        routine_id: Uuid,
        /// The run (`action_execution_record`).
        run_id: Uuid,
    },
}

impl FeedbackSubject {
    /// Which kind of response this is.
    pub fn kind(&self) -> SubjectKind {
        match self {
            Self::AgentSessionTurn { .. } => SubjectKind::AgentSessionTurn,
            Self::Message { .. } => SubjectKind::Message,
            Self::RoutineRun { .. } => SubjectKind::RoutineRun,
        }
    }

    /// The container one person's feedback is listed by: the session, the
    /// message's parent, or the routine.
    pub fn container_id(&self) -> String {
        match self {
            Self::AgentSessionTurn { session_id, .. } => session_id.as_uuid().to_string(),
            Self::Message { parent, .. } => parent.entity_id(),
            Self::RoutineRun { routine_id, .. } => routine_id.to_string(),
        }
    }

    /// The rated thing's own id: the session, the message, or the run.
    pub fn subject_id(&self) -> Uuid {
        match self {
            Self::AgentSessionTurn { session_id, .. } => session_id.as_uuid(),
            Self::Message { message_id, .. } => *message_id,
            Self::RoutineRun { run_id, .. } => *run_id,
        }
    }

    /// The turn, for a session reply.
    pub fn turn(&self) -> Option<u32> {
        match self {
            Self::AgentSessionTurn { turn, .. } => Some(*turn),
            Self::Message { .. } | Self::RoutineRun { .. } => None,
        }
    }
}

/// A response, with the caller's view access to the container it lives in.
/// The service checks the response belongs to that container.
#[derive(Debug, Clone)]
pub enum RatedResponse {
    /// A reply turn of the session the receipt is for.
    AgentSessionTurn {
        /// View access to the session.
        session: EntityAccessReceipt<ViewAccessLevel>,
        /// The turn.
        turn: u32,
    },
    /// A message on the parent the receipt is for.
    Message {
        /// The parent, as the route named it.
        parent: MessageParent,
        /// View access to the parent's messages.
        access: EntityAccessReceipt<MessageView>,
        /// The message.
        message_id: Uuid,
    },
    /// A run of the routine the receipt is for.
    RoutineRun {
        /// View access to the routine.
        routine: EntityAccessReceipt<ViewAccessLevel>,
        /// The run.
        run_id: Uuid,
    },
}

/// A container whose responses one person rated, with their view access to it.
#[derive(Debug, Clone)]
pub enum FeedbackContainer {
    /// An agent session.
    AgentSession(EntityAccessReceipt<ViewAccessLevel>),
    /// A message parent (channel, document, call, ...).
    MessageParent {
        /// The parent, as the route named it.
        parent: MessageParent,
        /// View access to its messages.
        access: EntityAccessReceipt<MessageView>,
    },
    /// A routine.
    Routine(EntityAccessReceipt<ViewAccessLevel>),
}

/// A note on a rating: at most [`NOTE_MAX_CHARS`] characters, never empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note(String);

impl Note {
    /// Accept a note; an empty or blank one is no note.
    pub fn parse(text: Option<String>) -> Result<Option<Self>, FeedbackError> {
        let Some(text) = text else {
            return Ok(None);
        };
        if text.trim().is_empty() {
            return Ok(None);
        }
        if text.chars().count() > NOTE_MAX_CHARS {
            return Err(FeedbackError::Invalid(
                "note is longer than 4000 characters",
            ));
        }
        Ok(Some(Self(text)))
    }

    /// The note's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A rating the caller asks for.
#[derive(Debug, Clone)]
pub struct RateRequest {
    /// Minted by the client per action; a retry sends the same id.
    pub id: Uuid,
    /// Up or down.
    pub rating: Rating,
    /// An optional note.
    pub note: Option<String>,
    /// Where the response was seen.
    pub surface: Surface,
    /// The trace of the request, recorded with the row.
    pub trace_id: Option<String>,
}

/// A retraction the caller asks for.
#[derive(Debug, Clone)]
pub struct RetractRequest {
    /// Minted by the client per action; a retry sends the same id.
    pub id: Uuid,
    /// Where the response was seen.
    pub surface: Surface,
    /// The trace of the request, recorded with the row.
    pub trace_id: Option<String>,
}

/// Facts about the agent that produced a response, read server-side when the
/// rating is written. Every field is optional: what is unknown stays empty.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResponseContext {
    /// For a message: its parent's type (`channel`, `document`, ...).
    pub message_parent_type: Option<&'static str>,
    /// The session that produced the response.
    pub agent_session_id: Option<AgentSessionId>,
    /// The bot that produced it.
    pub agent_bot_id: Option<BotId>,
    /// The teammate account that produced it.
    pub agent_user_id: Option<MacroUserIdStr<'static>>,
    /// What kind of agent produced it.
    pub agent_kind: Option<AgentKind>,
    /// The session's harness.
    pub harness: Option<String>,
    /// The session's model when the rating was written.
    pub model: Option<String>,
}

/// One row to append: a rating, a change, or a retraction (no rating).
#[derive(Debug, Clone)]
pub struct FeedbackWrite {
    /// The client's id for the action.
    pub id: Uuid,
    /// Who rated.
    pub user: MacroUserIdStr<'static>,
    /// What was rated.
    pub subject: FeedbackSubject,
    /// The rating; `None` retracts.
    pub rating: Option<Rating>,
    /// The note; only with a rating.
    pub note: Option<Note>,
    /// Where it was seen.
    pub surface: Surface,
    /// What produced the response.
    pub context: ResponseContext,
    /// The request's trace.
    pub trace_id: Option<String>,
}

/// One person's current feedback on one response.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackState {
    /// The current rating; `None` when there is none or it was retracted.
    #[schema(required = true)]
    pub rating: Option<Rating>,
    /// The current note.
    #[schema(required = true)]
    pub note: Option<String>,
    /// When the current state was written; `None` when nothing was.
    #[schema(required = true)]
    pub updated_at: Option<DateTime<Utc>>,
}

/// What appending a row did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppendOutcome {
    /// The row was written; the state it made.
    Created(FeedbackState),
    /// The newest row already says the same; nothing was written.
    Unchanged(FeedbackState),
    /// This id was already written for the same person and response (a
    /// retry); nothing was written. The current state.
    Replayed(FeedbackState),
    /// The id belongs to another person's or another response's row.
    IdTaken,
}

/// One person's current rating of one response in a container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MyFeedback {
    /// The rated session, message or run.
    pub subject_id: Uuid,
    /// The turn, for a session reply.
    #[schema(required = true)]
    pub turn: Option<u32>,
    /// The rating.
    pub rating: Rating,
    /// The note.
    #[schema(required = true)]
    pub note: Option<String>,
    /// When it was written.
    pub updated_at: DateTime<Utc>,
}

/// Where an export page starts: after this row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportCursor {
    /// The last row's `created_at`.
    pub after_created_at: DateTime<Utc>,
    /// The last row's id.
    pub after_id: Uuid,
}

/// How many rows an export page holds: 1 to 1000.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportLimit(u16);

impl ExportLimit {
    /// The page size when the caller names none.
    pub const DEFAULT: Self = Self(500);
    /// The largest page.
    pub const MAX: u16 = 1000;

    /// Accept a page size from 1 to [`Self::MAX`].
    pub fn new(limit: u16) -> Result<Self, FeedbackError> {
        if limit == 0 || limit > Self::MAX {
            return Err(FeedbackError::Invalid("limit must be from 1 to 1000"));
        }
        Ok(Self(limit))
    }

    /// The page size.
    pub fn get(self) -> u16 {
        self.0
    }
}

/// One stored row, as the eval export reads it: ratings, changes and
/// retractions alike.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEvent {
    /// The row's id.
    pub id: Uuid,
    /// Who rated (a Macro user id).
    pub user_id: String,
    /// What kind of response.
    pub subject_kind: SubjectKind,
    /// Session, message parent or routine id.
    pub container_id: String,
    /// Session, message or run id.
    pub subject_id: Uuid,
    /// The turn, for a session reply.
    #[schema(required = true)]
    pub turn: Option<u32>,
    /// The rating; `None` is a retraction.
    #[schema(required = true)]
    pub rating: Option<Rating>,
    /// The note.
    #[schema(required = true)]
    pub note: Option<String>,
    /// Where the response was seen.
    pub surface: Surface,
    /// For a message, its parent's type.
    #[schema(required = true)]
    pub message_parent_type: Option<String>,
    /// The session that produced the response.
    #[schema(required = true)]
    pub agent_session_id: Option<Uuid>,
    /// The bot that produced it.
    #[schema(required = true)]
    pub agent_bot_id: Option<Uuid>,
    /// The teammate account that produced it.
    #[schema(required = true)]
    pub agent_user_id: Option<String>,
    /// What kind of agent produced it.
    #[schema(required = true)]
    pub agent_kind: Option<AgentKind>,
    /// The session's harness at rating time.
    #[schema(required = true)]
    pub harness: Option<String>,
    /// The session's model at rating time.
    #[schema(required = true)]
    pub model: Option<String>,
    /// The rating request's trace.
    #[schema(required = true)]
    pub trace_id: Option<String>,
    /// When it was written.
    pub created_at: DateTime<Utc>,
}

/// One page of the export.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportPage {
    /// Rows in `(created_at, id)` order.
    pub items: Vec<FeedbackEvent>,
    /// Where the next page starts; absent on the last page.
    #[schema(required = true)]
    pub next: Option<ExportCursor>,
}

/// Why a feedback request failed.
#[derive(Debug, thiserror::Error)]
pub enum FeedbackError {
    /// The feature is off for the caller.
    #[error("not found")]
    NotFound,
    /// The access shown does not cover the request.
    #[error("forbidden")]
    Forbidden,
    /// The response is not in the container the route names.
    #[error("the response is not in this container")]
    SubjectNotInContainer,
    /// The response was not written by an agent.
    #[error("the response was not written by an agent")]
    NotAgentAuthored,
    /// The request is malformed.
    #[error("{0}")]
    Invalid(&'static str),
    /// The id was used for another person's or another response's row.
    #[error("this id was already used for another rating")]
    IdTaken,
    /// Storage or a dependency failed.
    #[error("feedback storage is unavailable")]
    Unavailable(rootcause::Report),
}
