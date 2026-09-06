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
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

/// The identity of an agent session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentSessionId(Uuid);

impl AgentSessionId {
    /// A fixed id for tests.
    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_A: Self = Self(Uuid::from_u128(0xA));

    /// A second fixed id for tests that need two distinct sessions.
    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_B: Self = Self(Uuid::from_u128(0xB));

    /// Mint a fresh session id, backed by a UUIDv7.
    #[expect(clippy::new_without_default, reason = "each call mints a distinct id")]
    #[must_use]
    pub fn new() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Wrap an existing UUID as an agent session id.
    #[must_use]
    pub fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for AgentSessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// One protocol frame, tagged with the direction it travelled.
///
/// Serializes as `{"direction": "to_server" | "to_runtime", "content": <envelope>}`,
/// the same vocabulary the Postgres log storage uses for its `direction` and
/// `content` columns, so recorded fixtures and stored rows share one wire
/// format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", content = "content", rename_all = "snake_case")]
pub enum Message {
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
}
