//! In-memory port implementations and recorded fixtures for tests.
//!
//! Lets this crate's own tests - and crates that consume this one, like
//! `agent_session` - fold real recorded protocol traffic without a database.

use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::ports::LogRepo;
use agent_client_protocol::JsonRpcMessage;
use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::PromptRequest;
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

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

/// The hermetic fixture: one complete turn with prose, a permission-gated
/// terminal command, a patched-in edit, and a clean stop.
pub const TURN: &str = include_str!("../fixtures/turn.jsonl");

/// A real recording, sanitized: the smallest complete real session, one
/// prompt and one reply, opened with `session/new`.
///
/// Recordings under `~/.agent_runtime_sessions` are real ACP traffic, so
/// unlike [`TURN`] this was not hand-shaped to exercise anything in
/// particular - it is what a harness actually sends. Run through
/// `scripts/sanitize_recording.py` before being committed; see that script's
/// docs for what "sanitized" means here.
pub const REAL_SINGLE_TURN: &str = include_str!("../fixtures/real_single_turn.jsonl");

/// A real recording: three prompts in one session, opened with
/// `session/new` - ordinary multi-turn traffic, no resume involved.
pub const REAL_MULTI_TURN: &str = include_str!("../fixtures/real_multi_turn.jsonl");

/// A real recording: opens with `session/load` and then takes three more
/// prompts in the same log. Covers the mixed case a pure resume or a pure
/// fresh session does not: turn numbering has to pick up cleanly after a
/// resumed turn that never had a prompt of its own in this log.
pub const RESUMED_AND_CONTINUED: &str = include_str!("../fixtures/resumed_and_continued.jsonl");

/// A real recording that opens with `session/load` and carries no
/// `session/prompt` at all - the agent's reply is the only thing in the log,
/// answering a prompt that lives in the log of the session it resumed.
///
/// This is the regression fixture for the fold once dropping this content
/// outright: with no prompt to open a turn, every frame here used to have
/// nowhere to go, and the whole log folded to nothing. See
/// [`crate::domain::fold::State::begin_turn_without_prompt`].
pub const RESUMED_NO_PROMPT: &str = include_str!("../fixtures/resumed_no_prompt.jsonl");

/// A real recording: 6565 frames, 106 prompts, and three separate
/// `session/load` resumes in the same log - the longest and most-resumed
/// real session available. Where the other real fixtures each isolate one
/// shape, this is what a session actually looks like after running for a
/// while: many turns, and the fold picking back up cleanly every time the
/// connection dropped and reattached.
pub const LONG_MULTI_RESUME: &str = include_str!("../fixtures/long_multi_resume.jsonl");

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
