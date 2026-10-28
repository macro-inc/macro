//! Codex's session rollout, read back as ACP.
//!
//! The interactive Codex TUI appends each session's events to
//! `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session-id>.jsonl`. Its
//! `event_msg` entries carry one `item_completed` per finished item (agent
//! messages, reasoning, commands, file changes, tool calls) and a
//! `task_complete` or `turn_aborted` when a turn ends.

#![deny(missing_docs)]

use agent_fold::domain::transcript::{Fold, LogEvent, truncate};
use std::collections::HashSet;

use serde_json::{Value, json};

#[cfg(test)]
mod test;

const TITLE_LIMIT: usize = 80;

/// Rollout reader state, so a reopened file never replays an item.
#[derive(Debug, Default)]
pub struct CodexLog {
    seen: HashSet<String>,
}

impl Fold for CodexLog {
    /// Translate one rollout line.
    fn entry(&mut self, line: &str) -> Vec<LogEvent> {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        if entry.get("type").and_then(Value::as_str) == Some("turn_context") {
            return entry
                .pointer("/payload/model")
                .and_then(Value::as_str)
                .filter(|model| !model.is_empty())
                .map(|model| LogEvent::ModelChanged(model.to_owned()))
                .into_iter()
                .collect();
        }
        if entry.get("type").and_then(Value::as_str) != Some("event_msg") {
            return Vec::new();
        }
        let Some(payload) = entry.get("payload") else {
            return Vec::new();
        };
        match payload.get("type").and_then(Value::as_str) {
            Some("item_completed") => {
                let Some(item) = payload.get("item") else {
                    return Vec::new();
                };
                if let Some(id) = item.get("id").and_then(Value::as_str)
                    && !self.seen.insert(id.to_owned())
                {
                    return Vec::new();
                }
                item_update(item)
                    .map(LogEvent::Update)
                    .into_iter()
                    .collect()
            }
            Some("task_complete") => vec![LogEvent::TurnEnded("end_turn")],
            Some("turn_aborted") => vec![LogEvent::TurnEnded("cancelled")],
            _ => Vec::new(),
        }
    }
}

fn texts(value: Option<&Value>, field: &str) -> String {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| match part {
            Value::String(text) => Some(text.as_str()),
            part => part.get(field).and_then(Value::as_str),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn item_update(item: &Value) -> Option<Value> {
    let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
    let field = |name: &str| item.get(name).and_then(Value::as_str);
    match item.get("type").and_then(Value::as_str)? {
        "AgentMessage" | "UserMessage" => {
            let text = texts(item.get("content"), "text");
            (!text.is_empty()).then(|| {
                json!({
                    "sessionUpdate": if item["type"] == "UserMessage" { "user_message_chunk" } else { "agent_message_chunk" },
                    "content": {"type": "text", "text": text},
                })
            })
        }
        "Reasoning" => {
            let mut text = texts(item.get("summary_text"), "text");
            if text.is_empty() {
                text = texts(item.get("raw_content"), "text");
            }
            (!text.is_empty()).then(|| {
                json!({
                    "sessionUpdate": "agent_thought_chunk",
                    "content": {"type": "text", "text": text},
                })
            })
        }
        "CommandExecution" => {
            let command = command_line(item);
            let failed = field("status") == Some("failed")
                || item
                    .get("exit_code")
                    .and_then(Value::as_i64)
                    .is_some_and(|code| code != 0);
            Some(tool_call(
                id,
                &format!("Run {}", clip(&command)),
                command_kind(item),
                failed,
                field("aggregated_output").unwrap_or_default(),
                json!({"command": command}),
            ))
        }
        "FileChange" => {
            let paths = changed_paths(item);
            let title = if paths.is_empty() {
                "Edit files".to_owned()
            } else {
                format!("Edit {}", clip(&paths.join(", ")))
            };
            Some(tool_call(
                id,
                &title,
                "edit",
                field("status") == Some("failed"),
                "",
                json!({"paths": paths}),
            ))
        }
        "McpToolCall" => {
            let name = [field("server"), field("tool")]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(".");
            Some(tool_call(
                id,
                &format!("Call {}", if name.is_empty() { "tool" } else { &name }),
                "other",
                field("status") == Some("failed"),
                "",
                item.get("arguments").cloned().unwrap_or(Value::Null),
            ))
        }
        "WebSearch" => Some(tool_call(
            id,
            &format!("Search {}", clip(field("query").unwrap_or("the web"))),
            "search",
            false,
            "",
            Value::Null,
        )),
        _ => None,
    }
}

fn tool_call(
    id: &str,
    title: &str,
    kind: &str,
    failed: bool,
    output: &str,
    raw_input: Value,
) -> Value {
    let mut update = json!({
        "sessionUpdate": "tool_call",
        "toolCallId": id,
        "title": title,
        "kind": kind,
        "status": if failed { "failed" } else { "completed" },
        "rawInput": raw_input,
    });
    if !output.is_empty() {
        update["content"] = json!([{
            "type": "content",
            "content": {"type": "text", "text": truncate(output)},
        }]);
    }
    update
}

/// The script a command ran, without the `bash -lc` wrapper.
fn command_line(item: &Value) -> String {
    let argv: Vec<&str> = item
        .get("command")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    match argv.as_slice() {
        [shell, flag, script] if shell.ends_with("sh") && flag.starts_with('-') => {
            (*script).to_owned()
        }
        argv => argv.join(" "),
    }
}

fn command_kind(item: &Value) -> &'static str {
    let kinds: Vec<&str> = item
        .get("parsed_cmd")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|parsed| parsed.get("type").and_then(Value::as_str))
        .collect();
    if kinds.is_empty() {
        "execute"
    } else if kinds.iter().all(|kind| *kind == "read") {
        "read"
    } else if kinds
        .iter()
        .all(|kind| matches!(*kind, "search" | "list_files" | "read"))
    {
        "search"
    } else {
        "execute"
    }
}

fn changed_paths(item: &Value) -> Vec<String> {
    match item.get("changes") {
        Some(Value::Object(changes)) => changes.keys().cloned().collect(),
        Some(Value::Array(changes)) => changes
            .iter()
            .filter_map(|change| change.get("path").and_then(Value::as_str))
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

/// The first line of `text`, short enough for a tool title.
fn clip(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default();
    let mut clipped: String = line.chars().take(TITLE_LIMIT).collect();
    if line.chars().count() > TITLE_LIMIT || text.lines().nth(1).is_some() {
        clipped.push('…');
    }
    clipped
}
