//! Shared helpers for tests: parsing recorded protocol frames into log rows,
//! and bridging `agent_session`'s in-memory test double to [`LogRepo`].

use crate::domain::ports::LogRepo;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, AgentSessionLog, Message};
use agent_session::domain::ports::AgentSessionLogRepo;
use agent_session::testing::InMemoryAgentSessionRepo;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::VecDeque;

/// The trivial [`LogRepo`] this crate promises: `agent_session`'s in-memory
/// test double already speaks
/// [`AgentSessionLogRepo`](agent_session::domain::ports::AgentSessionLogRepo),
/// so bridging it is one line. The real Postgres adapter gets the same
/// treatment when it needs to answer [`FoldSession`](
/// crate::domain::ports::FoldSession) queries.
impl LogRepo for InMemoryAgentSessionRepo {
    async fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> Result<VecDeque<AgentSessionLog>, AgentSessionError> {
        let log = AgentSessionLogRepo::list_by_session(self, session).await?;
        Ok(log.into())
    }
}

/// The hermetic fixture: one complete turn with prose, a permission-gated
/// terminal command, a patched-in edit, and a clean stop.
pub const TURN: &str = include_str!("../../../fixtures/turn.jsonl");

/// The session id fixture logs are parsed into by default.
pub fn test_session() -> AgentSessionId {
    AgentSessionId::TEST_A
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

    let is_prompt = content
        .get("method")
        .and_then(|method| method.as_str())
        .is_some_and(|method| method == "session/prompt");

    let content = match direction {
        "to_server" => Message::ToServer(
            serde_json::from_value(content.clone()).expect("to_server frame deserializes"),
        ),
        "to_runtime" => Message::ToRuntime(
            serde_json::from_value(content.clone()).expect("to_runtime frame deserializes"),
        ),
        other => panic!("unknown direction {other}"),
    };

    AgentSessionLog {
        agent_session_id: session,
        user_id: is_prompt.then(|| {
            MacroUserIdStr::try_from_email("eric@example.com").expect("test email parses")
        }),
        content,
    }
}

/// Parse a whole recording into the given session's log.
pub fn parse_log_as(session: AgentSessionId, jsonl: &str) -> Vec<AgentSessionLog> {
    jsonl
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| parse_line(session, line))
        .collect()
}

/// Parse a whole recording into [`test_session`]'s log.
pub fn parse_log(jsonl: &str) -> Vec<AgentSessionLog> {
    parse_log_as(test_session(), jsonl)
}
