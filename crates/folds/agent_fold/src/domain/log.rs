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
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;

#[cfg(test)]
mod test;

/// The `_meta` key on `session/new`, `session/load` and `session/resume`
/// whose string value is the [`AgentSessionId`] the ACP session serves.
pub const MACRO_AGENT_SESSION_META_KEY: &str = "macro.com/agentSessionId";

/// The `_meta` key on `session/new`, `session/load` and `session/resume`
/// whose string value is how the session answers permission requests
/// (`autoAccept` or `prompt`), so a runtime can tell its agent.
pub const MACRO_PERMISSION_POLICY_META_KEY: &str = "macro.com/permissionPolicy";

/// Requests that hand the runtime its MCP servers and their credentials.
const SESSION_OPENING_METHODS: [&str; 3] = ["session/new", "session/load", "session/resume"];

/// What a stored session-opening request keeps of its params.
const SESSION_OPENING_PARAMS: [&str; 3] = ["sessionId", "cwd", "additionalDirectories"];

/// What a stored session-opening request keeps of its `_meta`.
const SESSION_OPENING_META_KEYS: [&str; 2] = [
    MACRO_AGENT_SESSION_META_KEY,
    MACRO_PERMISSION_POLICY_META_KEY,
];

/// Methods the server sends a runtime whose params hold no credential, so
/// the log keeps them whole. Any other method is stored without its params:
/// a new frame is recorded as having happened until someone adds it here.
const STORED_WHOLE_METHODS: [&str; 13] = [
    "initialize",
    "session/prompt",
    "session/cancel",
    "session/close",
    "session/list",
    "session/set_config_option",
    "session/set_mode",
    "session/set_model",
    "_macro/tool_approval",
    "_macro/review_updated",
    "_macro/context_summary",
    "_session/turn_complete",
    "_session/closed",
];

/// Reduce a server-to-runtime frame's JSON to what may be stored and served.
///
/// The runtime needs MCP credentials on the wire, and nothing that reads the
/// log needs them, so they end here. Safe to repeat on a redacted frame.
pub fn redact_stored_frame(frame: &mut Value) {
    let Some(frame) = frame.as_object_mut() else {
        return;
    };

    let Some(method) = frame.get("method").and_then(Value::as_str) else {
        return;
    };

    if STORED_WHOLE_METHODS.contains(&method) {
        return;
    }

    let is_session_opening = SESSION_OPENING_METHODS.contains(&method);
    if let Some(params) = frame.get_mut("params") {
        *params = if is_session_opening {
            stored_session_opening_params(params)
        } else {
            Value::Object(serde_json::Map::new())
        };
    }
}

/// The allowed params of a session-opening request. `mcpServers` stays an
/// empty list because the fold parses these requests, and the field is how
/// the protocol's types recognize them.
fn stored_session_opening_params(params: &Value) -> Value {
    let mut stored = serde_json::Map::new();

    for name in SESSION_OPENING_PARAMS {
        if let Some(value) = params.get(name) {
            stored.insert(name.to_owned(), value.clone());
        }
    }

    if params.get("mcpServers").is_some() {
        stored.insert("mcpServers".to_owned(), Value::Array(Vec::new()));
    }

    if let Some(meta) = params.get("_meta") {
        let kept: serde_json::Map<String, Value> = SESSION_OPENING_META_KEYS
            .iter()
            .filter_map(|key| Some(((*key).to_owned(), meta.get(*key)?.clone())))
            .collect();
        stored.insert("_meta".to_owned(), Value::Object(kept));
    }

    Value::Object(stored)
}

fn serialize_redacted<S: Serializer>(
    message: &ToRuntimeMessage,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut frame = serde_json::to_value(message).map_err(serde::ser::Error::custom)?;
    redact_stored_frame(&mut frame);
    frame.serialize(serializer)
}

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

/// A string that does not name an agent session.
#[derive(Debug, thiserror::Error)]
#[error("invalid agent session id")]
pub struct InvalidAgentSessionId;

impl std::str::FromStr for AgentSessionId {
    type Err = InvalidAgentSessionId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        value
            .parse::<Uuid>()
            .map(Self)
            .map_err(|_| InvalidAgentSessionId)
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
///
/// Serializing one always applies [`redact_stored_frame`], so storage and
/// every reader get the same credential-free frame. What goes to a runtime is
/// the bare [`ToRuntimeMessage`], which keeps its credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", content = "content", rename_all = "snake_case")]
pub enum Message {
    /// A trusted system-event invocation. Its ACP request is preserved for
    /// correlation and replay, while it never becomes a user message.
    #[serde(serialize_with = "serialize_redacted")]
    Notification(ToRuntimeMessage),
    /// Runtime → server traffic.
    ToServer(ToServerMessage),
    /// Server → runtime traffic.
    #[serde(serialize_with = "serialize_redacted")]
    ToRuntime(ToRuntimeMessage),
}

impl Message {
    /// This frame without credentials, for holding once it has been sent.
    pub fn redacted(self) -> Result<Self, serde_json::Error> {
        match self {
            Self::ToServer(_) => Ok(self),
            Self::Notification(_) | Self::ToRuntime(_) => {
                serde_json::from_value(serde_json::to_value(&self)?)
            }
        }
    }
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
