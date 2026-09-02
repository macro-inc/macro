//! The renderable message vocabulary.
//!
//! These types are the fold's output: what an agent session looks like once
//! its protocol log has been collapsed into something a channel can display.
//! Nothing here is persisted - a [`FoldedMessage`] is derived from
//! `agent_session_log` on every read, so the vocabulary is free to change
//! without a migration.
//!
//! The shapes are deliberately lossy. ACP carries plenty that no reader wants
//! to see (token usage, mode changes, capability handshakes); those frames are
//! dropped rather than modelled. What survives is the material a person would
//! recognize as the story of the session: what they asked, what the agent
//! said, what it ran, and what it wanted permission to do.

use agent_runtime_protocol::domain::action::AgentActionId;
use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;
use serde::Serialize;
use specta::Type;

/// Per-push change reports.
mod event;
/// Session-level metadata.
mod metadata;
/// The parts a message is made of.
mod part;
/// Permission requests and outcomes.
mod permission;
/// The agent's plan.
mod plan;
/// Delegated agents.
mod subagent;
/// Tool calls.
mod tool;
/// Macro user tools.
mod user_tool;

pub use event::{FoldEvent, OwnedFoldEvent};
pub use metadata::{AvailableCommand, Harness, ModelOption, SessionMetadata};
pub use part::{Control, ControlOutcome, MessagePart, StopReason};
pub use permission::{PermissionOption, PermissionOptionKind, PermissionOutcome};
pub use plan::{PlanEntry, PlanEntryPriority, PlanEntryStatus};
pub use subagent::{SubagentResult, ToolStats};
pub use tool::{AnsiText, FileDiff, ToolDetail, ToolName, ToolStatus};
pub use user_tool::UserToolOutcome;

/// One prompt-to-stop cycle within a session.
///
/// Assigned by the fold in log order starting at zero, so the same log always
/// yields the same ids. This is not the ACP request id - that correlation is
/// internal to the fold.
///
/// A turn is not the unit a channel renders - see [`MessageId`], which is
/// what a comms placeholder stores.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct TurnId(pub u32);

/// A tool call within a turn, identified by its ACP `toolCallId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct ToolUseId(pub String);

/// The natural key of a [`FoldedMessage`] within its session.
///
/// Nothing here is stored, so there is no surrogate row id to hand out.
/// Instead the key falls out of the fold's shape: a turn yields at most one
/// message per side of the conversation, so `(turn, author side)` identifies
/// a message - and because [`TurnId`]s are assigned in log order, the same
/// log always derives the same keys. Queries that pretend the messages are
/// stored address them by this.
///
/// The one exception to "nothing here is persisted": a comms placeholder
/// message stores the message it renders, as these two fields alongside a
/// session id, relying on exactly this stability. They stay two fields
/// everywhere they travel - column, wire, and JSON - so nothing has to format
/// or reparse a composite to get at either half. One placeholder per message,
/// not per turn: a turn's prompt and its reply are separate rows so each can
/// carry its own sender.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct MessageId {
    /// The turn the message belongs to.
    pub turn: TurnId,
    /// Which side of the conversation produced it.
    pub author: AuthorKind,
}

impl MessageId {
    /// The first folded message authored by `author` in a session.
    #[must_use]
    pub const fn first(author: AuthorKind) -> Self {
        Self {
            turn: TurnId(0),
            author,
        }
    }

    /// Address the other side of this turn without changing its turn id.
    #[must_use]
    pub const fn with_author(self, author: AuthorKind) -> Self {
        Self {
            turn: self.turn,
            author,
        }
    }
}

/// Which side of the conversation produced a message.
///
/// The identity-free discriminant of [`Author`], usable in a key where
/// [`Author`] itself carries a payload.
///
/// The wire names a [`MessageId`] is written with and parsed back from are
/// the strum-derived `snake_case` variant names - one source of truth for
/// both directions.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    strum::Display,
    strum::EnumString,
    strum::IntoStaticStr,
    serde::Serialize,
    serde::Deserialize,
)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuthorKind {
    /// A person.
    User,
    /// The agent.
    Agent,
}

impl AuthorKind {
    /// The wire name, as it appears in a [`MessageId`]'s string form.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// One renderable message folded out of a session's protocol log.
///
/// A turn produces at most two of these: the user's prompt and the agent's
/// reply. Both carry their content as an ordered part list, so a reader can
/// collapse runs of tool activity or interleave text and tools however it
/// likes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessage {
    /// the id of this message
    #[serde(rename = "turn")]
    pub id: TurnId,
    /// Who produced it.
    pub author: Author,
    /// The ACP request id of the frame that derived this message - the same
    /// string the control endpoint returned, for correlation. `None` on agent
    /// messages and on frames the control plane did not mint (other clients'
    /// requests, notifications).
    pub request_id: Option<AgentActionId>,
    /// Ordered content. Never empty - the fold drops messages with no parts.
    pub parts: NonEmpty<Vec<MessagePart>>,
    /// How the turn ended, on the agent message that closed it.
    ///
    /// `None` while a turn is still in flight, or when the session died
    /// without a response to the prompt.
    pub stop: Option<StopReason>,
}

impl FoldedMessage {
    /// This message's natural key within its session.
    #[must_use]
    pub fn id(&self) -> MessageId {
        MessageId {
            turn: self.id,
            author: self.author.kind(),
        }
    }
}

/// Who produced a [`FoldedMessage`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Author {
    /// A person, via `session/prompt`.
    ///
    /// The id comes from the log row rather than the ACP payload, and is
    /// absent when the prompt was not attributed to a user.
    User {
        /// The attributed user's id.
        #[serde(rename = "userId")]
        #[specta(type = Option<String>)]
        user_id: Option<MacroUserIdStr<'static>>,
    },
    /// The agent.
    Agent,
}

impl Author {
    /// Which side of the conversation this author is, identity dropped.
    #[must_use]
    pub fn kind(&self) -> AuthorKind {
        match self {
            Self::User { .. } => AuthorKind::User,
            Self::Agent => AuthorKind::Agent,
        }
    }
}
