//! Claude Code's session transcript, read back as ACP.
//!
//! Interactive Claude Code appends every message of a session to
//! `~/.claude/projects/<cwd>/<session-id>.jsonl` as it happens. Tailing that
//! file is how the herdr adapter streams a TUI-driven turn to Macro without
//! scraping the screen: each assistant block becomes a `session/update`, and
//! the assistant message that stops for a reason other than a tool call ends
//! the turn.

#![deny(missing_docs)]

use agent_fold::domain::transcript::{Fold, LogEvent, truncate};
use std::collections::HashSet;

use serde_json::{Value, json};

#[cfg(test)]
mod test;

/// Transcript reader state: lines are appended once, but a reader that
/// reopens the file must not replay them.
#[derive(Debug, Default)]
pub struct ClaudeLog {
    seen: HashSet<String>,
}

impl Fold for ClaudeLog {
    /// Translate one transcript line.
    fn entry(&mut self, line: &str) -> Vec<LogEvent> {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            return Vec::new();
        }
        if let Some(uuid) = entry.get("uuid").and_then(Value::as_str)
            && !self.seen.insert(uuid.to_owned())
        {
            return Vec::new();
        }
        let Some(message) = entry.get("message") else {
            return Vec::new();
        };
        match entry.get("type").and_then(Value::as_str) {
            Some("assistant") => assistant(message),
            Some("user") => user_message(message),
            _ => Vec::new(),
        }
    }
}

fn blocks(message: &Value) -> impl Iterator<Item = &Value> {
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn assistant(message: &Value) -> Vec<LogEvent> {
    let mut events: Vec<LogEvent> = blocks(message)
        .filter_map(|block| {
            let text = |field| block.get(field).and_then(Value::as_str);
            match block.get("type").and_then(Value::as_str)? {
                "text" => Some(json!({
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": text("text")?},
                })),
                "thinking" => Some(json!({
                    "sessionUpdate": "agent_thought_chunk",
                    "content": {"type": "text", "text": text("thinking")?},
                })),
                "tool_use" => {
                    let name = text("name").unwrap_or("tool");
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    Some(json!({
                        "sessionUpdate": "tool_call",
                        "toolCallId": text("id")?,
                        "title": tool_title(name, &input),
                        "kind": tool_kind(name),
                        "status": "in_progress",
                        "rawInput": input,
                        "_meta": {"claudeCode": {"toolName": name}},
                    }))
                }
                _ => None,
            }
        })
        .map(LogEvent::Update)
        .collect();
    if let Some(model) = message
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.is_empty() && !model.starts_with('<'))
    {
        events.insert(0, LogEvent::ModelChanged(model.to_owned()));
    }
    let stop = match message.get("stop_reason").and_then(Value::as_str) {
        Some("end_turn" | "stop_sequence") => Some("end_turn"),
        Some("max_tokens") => Some("max_tokens"),
        Some("refusal") => Some("refusal"),
        _ => None,
    };
    events.extend(stop.map(LogEvent::TurnEnded));
    events
}

fn user_message(message: &Value) -> Vec<LogEvent> {
    let mut events = tool_results(message);
    let text = match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        _ => blocks(message)
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    };
    if !text.is_empty() {
        events.push(LogEvent::Update(json!({
            "sessionUpdate": "user_message_chunk",
            "content": {"type": "text", "text": text},
        })));
    }
    events
}

fn tool_results(message: &Value) -> Vec<LogEvent> {
    blocks(message)
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
        .filter_map(|block| {
            let id = block.get("tool_use_id")?.as_str()?;
            let failed = block.get("is_error").and_then(Value::as_bool) == Some(true);
            let mut update = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": id,
                "status": if failed { "failed" } else { "completed" },
            });
            let output = result_text(block.get("content"));
            if !output.is_empty() {
                update["content"] = json!([{
                    "type": "content",
                    "content": {"type": "text", "text": truncate(&output)},
                }]);
            }
            Some(LogEvent::Update(update))
        })
        .collect()
}

fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn tool_title(name: &str, input: &Value) -> String {
    let field = |key| input.get(key).and_then(Value::as_str);
    let detail = match name {
        "Bash" => field("description").or_else(|| field("command")),
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            field("file_path").or_else(|| field("notebook_path"))
        }
        "Grep" | "Glob" => field("pattern"),
        "WebFetch" => field("url"),
        "WebSearch" => field("query"),
        "Task" | "Agent" => field("description"),
        _ => None,
    };
    match detail {
        Some(detail) => format!("{name} {detail}"),
        None => name.to_owned(),
    }
}

fn tool_kind(name: &str) -> &'static str {
    match name {
        "Read" => "read",
        "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => "edit",
        "Bash" => "execute",
        "Grep" | "Glob" | "WebSearch" => "search",
        "WebFetch" => "fetch",
        _ => "other",
    }
}
