//! Fold a recorded session and print the result.
//!
//! Loads a recording into a throwaway [`LogRepo`], queries it through the
//! domain service - the same path a real caller takes, with Postgres (or
//! whatever else stores the log) swapped out. The throwaway repo doubles as
//! a demonstration: implementing [`LogRepo`] for a one-off type is exactly
//! this small.
//!
//! ```sh
//! cargo run -p agent_fold --example fold_recording -- ~/.agent_runtime_sessions/<id>.jsonl
//! ```

use agent_fold::domain::model::{Author, MessagePart, ToolDetail};
use agent_fold::domain::ports::{FoldedMessageRepo, LogRepo};
use agent_fold::domain::service::FoldedMessageService;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, AgentSessionLog, Message};
use std::collections::VecDeque;

/// A [`LogRepo`] over one recording read straight off disk.
struct RecordedLog {
    session: AgentSessionId,
    entries: VecDeque<AgentSessionLog>,
}

impl LogRepo for RecordedLog {
    async fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> Result<VecDeque<AgentSessionLog>, AgentSessionError> {
        Ok(if session == self.session {
            self.entries.clone()
        } else {
            VecDeque::new()
        })
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: fold_recording <recording.jsonl>");
    let jsonl = std::fs::read_to_string(&path).expect("recording is readable");

    let session = AgentSessionId::TEST_A;
    let repo = RecordedLog {
        session,
        entries: jsonl
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| parse_line(session, line))
            .collect(),
    };

    let messages = FoldedMessageService::new(repo);
    let folded = messages
        .messages(session)
        .await
        .expect("in-memory repo cannot fail");

    for message in &folded {
        let author = match &message.author {
            Author::User(id) => format!(
                "user({})",
                id.as_ref()
                    .map_or_else(|| "?".to_owned(), ToString::to_string)
            ),
            Author::Agent => "agent".to_owned(),
        };
        println!(
            "── turn {} · {author} · stop {:?}",
            message.id.0, message.stop
        );
        for part in message.parts.iter() {
            match part {
                MessagePart::Text(text) => {
                    println!("   text ({} chars) {:?}", text.len(), preview(text))
                }
                MessagePart::Thought(text) => println!("   thought ({} chars)", text.len()),
                MessagePart::ToolUse(tool) => {
                    let detail = match &tool.detail {
                        ToolDetail::Terminal {
                            command, exit_code, ..
                        } => format!(
                            "terminal {:?} exit={exit_code:?}",
                            command.as_deref().map(preview)
                        ),
                        ToolDetail::Edit { diffs } => format!("edit {} diff(s)", diffs.len()),
                        ToolDetail::Read { paths } => format!("read {paths:?}"),
                        ToolDetail::Other { kind, .. } => format!("other kind={kind}"),
                    };
                    println!("   tool {} [{:?}] {detail}", tool.label, tool.status);
                }
                MessagePart::Permission(permission) => println!(
                    "   permission for {} -> {:?}",
                    permission.tool_call.0, permission.outcome
                ),
            }
        }
    }
}

/// Parse one recorded line into a log row for the given session.
fn parse_line(session: AgentSessionId, line: &str) -> AgentSessionLog {
    let value: serde_json::Value = serde_json::from_str(line).expect("line is JSON");
    let content = value.get("content").expect("line has content").clone();
    let content = match value.get("direction").and_then(|d| d.as_str()) {
        Some("to_server") => {
            Message::ToServer(serde_json::from_value(content).expect("to_server frame"))
        }
        Some("to_runtime") => {
            Message::ToRuntime(serde_json::from_value(content).expect("to_runtime frame"))
        }
        other => panic!("unknown direction {other:?}"),
    };
    AgentSessionLog {
        agent_session_id: session,
        user_id: None,
        content,
    }
}

fn preview(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default();
    let mut preview: String = line.chars().take(60).collect();
    if preview.len() < text.len() {
        preview.push('…');
    }
    preview
}
