//! Fold a recorded agent session into messages and print them.
//!
//! A throwaway [`LogRepo`] over the JSONL file answers the port, the log is
//! read through it and folded with [`fold`], and this binary owns what the
//! folded vocabulary looks like as terminal text - the rendering the library
//! deliberately leaves to its callers.
//!
//! ```sh
//! cargo run -p agent_fold --bin fold_jsonl -- ~/.agent_runtime_sessions/<id>.jsonl
//! ```

use agent_fold::domain::fold::fold;
use agent_fold::domain::model::{
    Author, FoldedMessage, MessagePart, Permission, PermissionOutcome, StopReason, ToolDetail,
    ToolStatus, ToolUse,
};
use agent_fold::domain::ports::LogRepo;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, AgentSessionLog, Message};
use clap::Parser;
use serde::Deserialize;
use std::collections::VecDeque;
use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

/// A [`LogRepo`] over a session recording read from a JSONL file.
///
/// Recordings (as written to `~/.agent_runtime_sessions`) are one JSON
/// object per line: `{"direction": "to_server" | "to_runtime", "content":
/// <frame>}`. A file holds exactly one session, and the recording does not
/// carry the session's id, so a fresh [`AgentSessionId`] is minted at load
/// time. The file is read and parsed eagerly in [`JsonlRecording::open`];
/// the port method answers from memory and cannot fail.
struct JsonlRecording {
    session: AgentSessionId,
    entries: VecDeque<AgentSessionLog>,
}

/// Why a recording failed to load.
#[derive(Debug, thiserror::Error)]
enum RecordingError {
    /// The file could not be read.
    #[error("failed to read recording")]
    Io(#[from] std::io::Error),
    /// A line was not a well-formed recorded frame.
    #[error("line {line} is not a recorded frame")]
    Frame {
        /// The offending line, 1-based.
        line: usize,
        /// What failed to parse.
        #[source]
        source: serde_json::Error,
    },
}

/// One line of a recording, as the recorder writes it.
#[derive(Deserialize)]
struct RecordedLine {
    direction: Direction,
    content: serde_json::Value,
}

/// Which way the recorded frame was travelling.
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Direction {
    ToServer,
    ToRuntime,
}

impl JsonlRecording {
    /// Load a recording, minting a fresh session id for it.
    ///
    /// Blank lines are skipped; anything else must parse as a recorded
    /// frame.
    fn open(path: &Path) -> Result<Self, RecordingError> {
        let session = AgentSessionId::new();
        let jsonl = std::fs::read_to_string(path)?;
        let entries = jsonl
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(index, line)| parse_line(session, index + 1, line))
            .collect::<Result<_, _>>()?;
        Ok(Self { session, entries })
    }

    /// How many ACP messages the recording holds, lifecycle events excluded.
    fn acp_messages(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| match &entry.content {
                Message::ToRuntime(_) => true,
                Message::ToServer(message) => matches!(message, ToServerMessage::Acp(_)),
            })
            .count()
    }
}

impl LogRepo for JsonlRecording {
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

/// Parse one recorded line into a log row for the given session.
fn parse_line(
    session: AgentSessionId,
    line_number: usize,
    line: &str,
) -> Result<AgentSessionLog, RecordingError> {
    let frame = |source| RecordingError::Frame {
        line: line_number,
        source,
    };
    let recorded: RecordedLine = serde_json::from_str(line).map_err(frame)?;
    let content = match recorded.direction {
        Direction::ToServer => {
            Message::ToServer(serde_json::from_value(recorded.content).map_err(frame)?)
        }
        Direction::ToRuntime => {
            Message::ToRuntime(serde_json::from_value(recorded.content).map_err(frame)?)
        }
    };
    Ok(AgentSessionLog {
        agent_session_id: session,
        user_id: None,
        content,
    })
}

/// Fold a recorded agent session into messages and print them.
#[derive(Parser)]
struct Args {
    /// Path to a session recording, e.g. ~/.agent_runtime_sessions/<id>.jsonl
    recording: PathBuf,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args = Args::parse();

    let recording = match JsonlRecording::open(&args.recording) {
        Ok(recording) => recording,
        Err(error) => return fail(&args.recording, &error),
    };
    let acp_messages = recording.acp_messages();
    let log = recording
        .list_by_session(recording.session)
        .await
        .expect("in-memory repo cannot fail");

    let started = Instant::now();
    let folded = fold(log);
    let fold_time = started.elapsed();

    for message in &folded {
        print!("{}", render_message(message));
    }
    println!("── stats ──");
    println!("acp messages:    {acp_messages}");
    println!("folded messages: {}", folded.len());
    println!("fold time:       {fold_time:?}");
    ExitCode::SUCCESS
}

/// Print a load failure and its cause chain.
fn fail(path: &std::path::Path, error: &dyn std::error::Error) -> ExitCode {
    eprint!("error: cannot load {}: {error}", path.display());
    let mut cause = error.source();
    while let Some(source) = cause {
        eprint!(": {source}");
        cause = source.source();
    }
    eprintln!();
    ExitCode::FAILURE
}

/// One message as terminal text: a header line, then its parts in order.
fn render_message(message: &FoldedMessage) -> String {
    let mut out = String::new();
    let author = match &message.author {
        Author::User(Some(id)) => format!("user {id}"),
        Author::User(None) => "user".to_owned(),
        Author::Agent => "agent".to_owned(),
    };
    let stop = message
        .stop
        .as_ref()
        .map(|stop| format!(" · {}", render_stop(stop)))
        .unwrap_or_default();
    let _ = writeln!(out, "── turn {} · {author}{stop} ──", message.id.0);
    for part in message.parts.iter() {
        match part {
            MessagePart::Text(text) => {
                let _ = writeln!(out, "{}", text.trim_end());
            }
            MessagePart::Thought(text) => {
                let _ = writeln!(out, "[thought]\n{}", indent(text.trim_end()));
            }
            MessagePart::ToolUse(tool) => out.push_str(&render_tool(tool)),
            MessagePart::Permission(permission) => out.push_str(&render_permission(permission)),
        }
        out.push('\n');
    }
    out
}

/// A tool call: `[label · status]` then whatever detail the fold recovered.
fn render_tool(tool: &ToolUse) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "[{} · {}]", tool.label, render_status(tool.status));
    match &tool.detail {
        ToolDetail::Terminal {
            command,
            output,
            exit_code,
        } => {
            if let Some(command) = command {
                let _ = writeln!(out, "{}", indent(&format!("$ {}", command.trim_end())));
            }
            if let Some(output) = output {
                let _ = writeln!(out, "{}", indent(output.as_str().trim_end()));
            }
            if let Some(exit_code) = exit_code {
                let _ = writeln!(out, "{}", indent(&format!("(exit {exit_code})")));
            }
        }
        ToolDetail::Edit { diffs } => {
            for diff in diffs {
                let new_lines = diff.new_text.lines().count();
                let change = match &diff.old_text {
                    Some(old_text) => {
                        format!("{} → {new_lines} lines", old_text.lines().count())
                    }
                    None => format!("new file, {new_lines} lines"),
                };
                let _ = writeln!(
                    out,
                    "{}",
                    indent(&format!("{} ({change})", diff.path.display()))
                );
            }
        }
        ToolDetail::Read { paths } => {
            for path in paths {
                let _ = writeln!(out, "{}", indent(&path.display().to_string()));
            }
        }
        ToolDetail::Other { kind, input } => {
            let _ = writeln!(out, "{}", indent(&format!("kind: {kind}")));
            if let Some(input) = input {
                let json =
                    serde_json::to_string_pretty(input).unwrap_or_else(|_| input.to_string());
                let _ = writeln!(out, "{}", indent(&json));
            }
        }
    }
    out
}

/// A permission request: what was asked, what was offered, what was chosen.
fn render_permission(permission: &Permission) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "[permission · for {}]", permission.tool_call.0);
    for option in &permission.options {
        let _ = writeln!(
            out,
            "{}",
            indent(&format!("- {} ({})", option.name, option.kind))
        );
    }
    let outcome = match &permission.outcome {
        Some(PermissionOutcome::Selected { option_id }) => {
            let name = permission
                .options
                .iter()
                .find(|option| option.id == *option_id)
                .map_or(option_id.as_str(), |option| option.name.as_str());
            format!("chose: {name}")
        }
        Some(PermissionOutcome::Cancelled) => "cancelled".to_owned(),
        None => "unanswered".to_owned(),
    };
    let _ = writeln!(out, "{}", indent(&format!("→ {outcome}")));
    out
}

fn render_status(status: ToolStatus) -> &'static str {
    match status {
        ToolStatus::Pending => "pending",
        ToolStatus::Running => "running",
        ToolStatus::Completed => "completed",
        ToolStatus::Failed => "failed",
    }
}

fn render_stop(stop: &StopReason) -> String {
    match stop {
        StopReason::EndTurn => "end of turn".to_owned(),
        StopReason::MaxTokens => "hit max tokens".to_owned(),
        StopReason::MaxTurnRequests => "hit max turn requests".to_owned(),
        StopReason::Refusal => "refused".to_owned(),
        StopReason::Cancelled => "cancelled".to_owned(),
        StopReason::Other(reason) => format!("stopped: {reason}"),
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
