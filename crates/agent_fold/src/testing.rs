//! In-memory port implementations for tests.
//!
//! Lets this crate's own tests - and crates that consume this one, like
//! `agent_session` - exercise the fold without a database.

use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::ports::LogRepo;
use agent_client_protocol::JsonRpcMessage;
use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::PromptRequest;
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

/// Recorded and hand-shaped protocol logs shared by tests.
pub mod fixtures;

/// The compact complete-turn fixture, retained at its original path for
/// downstream tests.
pub use fixtures::TURN;

/// An in-memory [`LogRepo`].
///
/// Cheap to clone - clones share one store, so a handle kept for appends
/// sees reads made through the copy under test. Entries are returned in
/// insertion order, the chronology the real repo gets from
/// `ORDER BY created_at, id`.
#[derive(Debug, Clone, Default)]
pub struct InMemoryLog {
    entries: Arc<Mutex<HashMap<AgentSessionId, Vec<AgentSessionLog>>>>,
}

impl InMemoryLog {
    /// An empty log.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Append entries, in the order they should be read back.
    pub fn extend(&self, entries: impl IntoIterator<Item = AgentSessionLog>) {
        let mut logs = self.entries.lock().expect("in-memory log is not poisoned");
        for entry in entries {
            logs.entry(entry.agent_session_id).or_default().push(entry);
        }
    }
}

impl FromIterator<AgentSessionLog> for InMemoryLog {
    fn from_iter<I: IntoIterator<Item = AgentSessionLog>>(entries: I) -> Self {
        let log = Self::new();
        log.extend(entries);
        log
    }
}

impl LogRepo for InMemoryLog {
    async fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> Result<VecDeque<AgentSessionLog>, rootcause::Report> {
        Ok(self
            .entries
            .lock()
            .expect("in-memory log is not poisoned")
            .get(&session)
            .cloned()
            .unwrap_or_default()
            .into())
    }
}

/// The session id fixture logs are parsed into by default.
#[must_use]
pub fn test_session() -> AgentSessionId {
    AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(1))
}

/// Parse one recorded line - the agent_session_recorder / fixture format:
/// `{"ts": ..., "direction": "to_server" | "to_runtime", "content": {...}}` -
/// into the log row the fold consumes.
///
/// Prompts get a user id attached, mirroring what the agent service stamps
/// onto `agent_session_log.user_id` for user-originated ACP traffic.
fn parse_line(session: AgentSessionId, line: &str) -> AgentSessionLog {
    let value: serde_json::Value = serde_json::from_str(line).expect("recorded line is JSON");
    let direction = value
        .get("direction")
        .and_then(|direction| direction.as_str())
        .expect("recorded line has a direction");
    let content = value.get("content").expect("recorded line has content");

    let content = match direction {
        "to_server" => Message::ToServer(
            serde_json::from_value(content.clone()).expect("to_server frame deserializes"),
        ),
        "to_runtime" => Message::ToRuntime(
            serde_json::from_value(content.clone()).expect("to_runtime frame deserializes"),
        ),
        other => panic!("unknown direction {other}"),
    };

    // Matched on the parsed frame through the crate's own helper rather than
    // the raw JSON's `method` string, so a fixture parser and the fold it
    // feeds agree on what a prompt is by construction.
    let is_prompt = matches!(
        &content,
        Message::ToRuntime(ToRuntimeMessage::Acp(acp))
            if matches!(
                &acp.0,
                RawJsonRpcMessage::Request(request)
                    if PromptRequest::matches_method(&request.method)
            )
    );

    AgentSessionLog {
        agent_session_id: session,
        user_id: is_prompt.then(|| {
            MacroUserIdStr::try_from_email("eric@example.com").expect("test email parses")
        }),
        content,
    }
}

/// Parse a whole recording into the given session's log.
#[must_use]
pub fn parse_log_as(session: AgentSessionId, jsonl: &str) -> Vec<AgentSessionLog> {
    jsonl
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| parse_line(session, line))
        .collect()
}

/// Parse a whole recording into [`test_session`]'s log.
#[must_use]
pub fn parse_log(jsonl: &str) -> Vec<AgentSessionLog> {
    parse_log_as(test_session(), jsonl)
}
