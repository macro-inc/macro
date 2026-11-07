//! The raw protocol log vocabulary the fold consumes.
//!
//! These types describe one entry of an agent session's protocol log: which
//! session it belongs to, which direction the frame travelled, and who (if
//! anyone) originated it. They live in this crate - the bottom of the agent
//! session stack - so that storage and orchestration (`agent_session`) can
//! depend on the fold rather than the other way around; `agent_session`
//! re-exports them from its own model module, which is where most callers
//! meet them.

use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

pub use agent_session_id::{AgentSessionId, InvalidAgentSessionId};

/// One protocol frame, tagged with the direction it travelled.
///
/// Serializes as `{"direction": "to_server" | "to_runtime", "content": <envelope>}`,
/// the same vocabulary the Postgres log storage uses for its `direction` and
/// `content` columns, so recorded fixtures and stored rows share one wire
/// format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", content = "content", rename_all = "snake_case")]
pub enum Message {
    /// A trusted system-event invocation. Its ACP request is preserved for
    /// correlation and replay, while it never becomes a user message.
    Notification(ToRuntimeMessage),
    /// Runtime → server traffic.
    ToServer(ToServerMessage),
    /// Server → runtime traffic.
    ToRuntime(ToRuntimeMessage),
}

/// One entry of a session's protocol log.
#[derive(Debug, Clone)]
pub struct AgentSessionLog {
    /// The session the entry belongs to.
    pub agent_session_id: AgentSessionId,
    /// if this is ACP sent by a user this will be Some
    pub user_id: Option<MacroUserIdStr<'static>>,
    /// The logged frame.
    pub content: Message,
    /// When the log stored the entry. `None` for a frame not stored yet: one
    /// being appended, or one this client speculated.
    pub logged_at: Option<DateTime<Utc>>,
}
