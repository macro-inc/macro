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

use agent_fold::domain::fold::FoldMachineImpl;
use agent_fold::domain::log::{AgentSessionId, AgentSessionLog, Message};
use agent_fold::domain::model::{
    Author, Control, ControlOutcome, FoldedMessage, MessagePart, PermissionOption,
    PermissionOutcome, PlanEntryStatus, StopReason, ToolDetail, ToolStatus, ToolUseId,
};
use agent_fold::domain::ports::FoldMachine;
use agent_fold::domain::ports::LogRepo;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
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
    ) -> Result<VecDeque<AgentSessionLog>, rootcause::Report> {
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
    let mut machine = FoldMachineImpl::new();
    for entry in log {
        let _ = machine.push(entry);
    }
    let fold_time = started.elapsed();
    let metadata = machine.metadata().clone();
    let folded = machine.into_messages();

    for message in &folded {
        print!("{}", render_message(message));
    }
    println!("── metadata ──");
    println!("harness:  {:?}", metadata.harness);
    println!("model:    {}", metadata.model.as_deref().unwrap_or("-"));
    println!("title:    {}", metadata.title.as_deref().unwrap_or("-"));
    println!(
        "models:   {}",
        metadata
            .supported_models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("commands: {}", metadata.available_commands.len());
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
        Author::User { user_id: Some(id) } => format!("user {id}"),
        Author::User { user_id: None } => "user".to_owned(),
        Author::Agent => "agent".to_owned(),
    };
    let stop = message
        .stop
        .as_ref()
        .map(|stop| format!(" · {}", render_stop(stop)))
        .unwrap_or_default();
    let _ = writeln!(out, "── turn {} · {author}{stop} ──", message.id.0);
    for part in message.parts.iter() {
        out.push_str(&render_part(part));
        out.push('\n');
    }
    out
}

/// One part as terminal text.
fn render_part(part: &MessagePart) -> String {
    let mut out = String::new();
    {
        match part {
            MessagePart::Text { text } => {
                let _ = writeln!(out, "{}", text.trim_end());
            }
            MessagePart::Thought { text } => {
                let _ = writeln!(out, "[thought]\n{}", indent(text.trim_end()));
            }
            MessagePart::ToolUse {
                name,
                status,
                detail,
                ..
            } => out.push_str(&render_tool(name.display(), *status, detail)),
            MessagePart::Permission {
                tool_call,
                options,
                outcome,
            } => out.push_str(&render_permission(tool_call, options, outcome)),
            MessagePart::Control { control, outcome } => {
                let label = match control {
                    Control::SetModel { model } => format!("model changed to {model}"),
                    Control::Compact => "context compacted".to_owned(),
                    Control::Stop => "stop requested".to_owned(),
                };
                let disposition = match outcome {
                    ControlOutcome::Pending => " (pending)",
                    ControlOutcome::Accepted => "",
                    ControlOutcome::Rejected { .. } => " (rejected)",
                };
                let _ = writeln!(out, "[{label}{disposition}]");
            }
            MessagePart::Plan { entries } => {
                let _ = writeln!(out, "[plan]");
                for entry in entries {
                    let mark = match entry.status {
                        PlanEntryStatus::Pending => " ",
                        PlanEntryStatus::InProgress => "~",
                        PlanEntryStatus::Completed => "x",
                    };
                    let _ = writeln!(out, "{}", indent(&format!("[{mark}] {}", entry.content)));
                }
            }
        }
    }
    out
}

/// A tool call: `[label · status]` then whatever detail the fold recovered.
fn render_tool(label: &str, status: ToolStatus, detail: &ToolDetail) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "[{label} · {status}]");
    match detail {
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
        ToolDetail::Read { paths } | ToolDetail::Delete { paths } | ToolDetail::Move { paths } => {
            for path in paths {
                let _ = writeln!(out, "{}", indent(&path.display().to_string()));
            }
        }
        ToolDetail::Search { paths, output } => {
            for path in paths {
                let _ = writeln!(out, "{}", indent(&path.display().to_string()));
            }
            if let Some(output) = output {
                let _ = writeln!(out, "{}", indent(output.trim_end()));
            }
        }
        ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
            if let Some(output) = output {
                let _ = writeln!(out, "{}", indent(output.trim_end()));
            }
        }
        ToolDetail::Other {
            kind,
            output,
            input,
        } => {
            let _ = writeln!(out, "{}", indent(&format!("kind: {kind}")));
            if let Some(output) = output {
                let _ = writeln!(out, "{}", indent(output.trim_end()));
            }
            if let Some(input) = input {
                let _ = writeln!(out, "{}", indent(&pretty(input)));
            }
        }
        ToolDetail::Macro {
            input,
            output,
            error,
        } => {
            let _ = writeln!(out, "{}", indent(&format!("input: {}", pretty(input))));
            if let Some(output) = output {
                let _ = writeln!(out, "{}", indent(&format!("output: {}", pretty(output))));
            }
            if let Some(error) = error {
                let _ = writeln!(out, "{}", indent(&format!("error: {error}")));
            }
        }
        ToolDetail::UserTool { input, outcome } => {
            let _ = writeln!(out, "{}", indent(&format!("draft: {}", pretty(input))));
            let _ = writeln!(out, "{}", indent(&format!("outcome: {outcome:?}")));
        }
        ToolDetail::Subagent {
            title,
            agent_type,
            description,
            prompt,
            background,
            children,
            result,
        } => {
            let mut head = vec![format!("title: {title}")];
            if let Some(agent_type) = agent_type {
                head.push(format!("type: {agent_type}"));
            }
            if let Some(description) = description {
                head.push(format!("description: {description}"));
            }
            if *background {
                head.push("background".to_owned());
            }
            if !head.is_empty() {
                let _ = writeln!(out, "{}", indent(&head.join(" · ")));
            }
            if let Some(prompt) = prompt {
                let _ = writeln!(out, "{}", indent(&format!("> {}", prompt.trim_end())));
            }
            for child in children {
                let _ = writeln!(out, "{}", indent(render_part(child).trim_end()));
            }
            if let Some(result) = result {
                if let Some(text) = &result.text {
                    let _ = writeln!(out, "{}", indent(&format!("result: {}", text.trim_end())));
                }
                if let Some(error) = &result.error {
                    let _ = writeln!(out, "{}", indent(&format!("error: {error}")));
                }
                let mut facts = Vec::new();
                if let Some(model) = &result.model {
                    facts.push(model.clone());
                }
                if let Some(tool_uses) = result.tool_uses {
                    facts.push(format!("{tool_uses} tool uses"));
                }
                if let Some(ms) = result.duration_ms {
                    facts.push(format!("{ms}ms"));
                }
                if let Some(tokens) = result.tokens {
                    facts.push(format!("{tokens} tokens"));
                }
                if !facts.is_empty() {
                    let _ = writeln!(out, "{}", indent(&facts.join(" · ")));
                }
            }
        }
    }
    out
}

/// JSON, pretty-printed, or its compact form if that somehow fails.
fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

/// A permission request: what was asked, what was offered, what was chosen.
fn render_permission(
    tool_call: &ToolUseId,
    options: &[PermissionOption],
    outcome: &PermissionOutcome,
) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "[permission · for {}]", tool_call.0);
    for option in options {
        let _ = writeln!(
            out,
            "{}",
            indent(&format!("- {} ({:?})", option.name, option.kind))
        );
    }
    let outcome = match outcome {
        PermissionOutcome::Selected { option_id } => {
            let name = options
                .iter()
                .find(|option| option.id == *option_id)
                .map_or(option_id.as_str(), |option| option.name.as_str());
            format!("chose: {name}")
        }
        PermissionOutcome::Cancelled => "cancelled".to_owned(),
        PermissionOutcome::Pending => "pending".to_owned(),
        PermissionOutcome::Errored => "errored".to_owned(),
        PermissionOutcome::Unrecognized => "unrecognized".to_owned(),
    };
    let _ = writeln!(out, "{}", indent(&format!("→ {outcome}")));
    out
}

fn render_stop(stop: &StopReason) -> String {
    match stop {
        StopReason::EndTurn => "end of turn".to_owned(),
        StopReason::MaxTokens => "hit max tokens".to_owned(),
        StopReason::MaxTurnRequests => "hit max turn requests".to_owned(),
        StopReason::Refusal => "refused".to_owned(),
        StopReason::Cancelled => "cancelled".to_owned(),
        StopReason::Other { reason } => format!("stopped: {reason}"),
        StopReason::Failed { message } => format!("failed: {message}"),
    }
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
