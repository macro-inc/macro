//! Reads one agent's transcript for the drill-in page: the last items of its
//! Claude Code transcript or Codex rollout, then every item appended to it.
//!
//! The backlog is read with the sources' byte-offset tail (never the whole
//! file at once), and appends wake the follower through a file-system watch
//! on the transcript's directory, never a timer. Text is clipped and only
//! ever leaves through the stream: nothing here logs it or puts it on a span.

#[cfg(test)]
mod test;

use std::collections::{HashMap, VecDeque};
use std::io;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use chrono::Utc;
use serde::Deserialize;

use crate::domain::model::{Agent, Timestamp, TranscriptItem, TranscriptItemKind};
use crate::domain::source::{TranscriptError, TranscriptFeed, TranscriptStream};
use crate::outbound::tail::Tail;
use crate::outbound::watch::Watch;

/// Characters kept of a message.
const MESSAGE_LIMIT: usize = 2000;

/// Characters kept of a tool call's arguments or its result.
const TOOL_LIMIT: usize = 600;

/// Tool calls remembered while waiting for their results; a transcript that
/// never answers its calls cannot grow this without bound.
const OPEN_TOOLS_LIMIT: usize = 4096;

/// Codex rollouts are named `rollout-<time>-<session id>.jsonl`.
const CODEX_PREFIX: &str = "rollout-";

/// Claude Code lines worth decoding; snapshots and the rest are skipped.
const CLAUDE_WANTED: &[&[u8]] = &[b"\"type\":\"assistant\"", b"\"type\":\"user\""];

/// Codex lines worth decoding.
const CODEX_WANTED: &[&[u8]] = &[b"\"response_item\""];

/// Follows Claude Code transcripts and Codex rollouts on this machine.
#[derive(Clone, Copy, Debug, Default)]
pub struct LocalTranscripts;

#[async_trait]
impl TranscriptFeed for LocalTranscripts {
    async fn follow(
        &self,
        agent: &Agent,
        tail: usize,
    ) -> Result<TranscriptStream, TranscriptError> {
        let path = agent
            .transcript
            .clone()
            .ok_or(TranscriptError::Unavailable)?;
        let mut follower = Follower::new(path);

        let span = tracing::info_span!(
            "macrod.monitor.transcript.backlog",
            items = tracing::field::Empty,
        );
        let (follower, past) = tokio::task::spawn_blocking(move || {
            let past = follower.backlog(tail);
            (follower, past)
        })
        .await
        .map_err(|error| rootcause::report!("transcript read task failed: {error}"))?;
        let past = past.map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => TranscriptError::Unavailable,
            _ => rootcause::report!("cannot read the transcript: {error}").into(),
        })?;
        span.record("items", past.len());

        Ok(Box::pin(follow(follower, past)))
    }
}

/// The backlog, then appends until the file goes away or the watch stops.
fn follow(
    mut follower: Follower,
    past: Vec<TranscriptItem>,
) -> impl futures::Stream<Item = TranscriptItem> + Send {
    async_stream::stream! {
        for item in past {
            yield item;
        }

        let Some(directory) = follower.path.parent().map(Path::to_owned) else {
            return;
        };
        let mut watch = match Watch::new() {
            Ok(watch) => watch,
            Err(error) => {
                tracing::warn!(error = %error, "cannot watch a transcript; not following it");
                return;
            }
        };
        if let Err(error) = watch.add(&directory, false) {
            tracing::warn!(error = %error, "cannot watch a transcript; not following it");
            return;
        }

        // Read once more now that the watch is in place: a line written
        // between the backlog and the watch has no notification of its own.
        loop {
            let read = tokio::task::spawn_blocking(move || {
                let items = follower.appended();
                (follower, items)
            })
            .await;
            let Ok((returned, items)) = read else { return };
            follower = returned;
            let Ok(items) = items else { return };
            for item in items {
                yield item;
            }

            loop {
                let Some(changes) = watch.next().await else { return };
                if changes.rescan || changes.paths.contains(&follower.path) {
                    break;
                }
            }
        }
    }
}

/// Where one transcript was read up to, and its decoder.
struct Follower {
    path: PathBuf,
    tail: Tail,
    decoder: Decoder,
}

impl Follower {
    fn new(path: PathBuf) -> Self {
        let codex = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(CODEX_PREFIX));
        let format = if codex { Format::Codex } else { Format::Claude };
        Self {
            path,
            tail: Tail::default(),
            decoder: Decoder {
                format,
                open_tools: HashMap::new(),
            },
        }
    }

    /// Reads the whole file in batches, keeping only the last `keep` items.
    fn backlog(&mut self, keep: usize) -> io::Result<Vec<TranscriptItem>> {
        let mut last = VecDeque::with_capacity(keep.min(1024));
        loop {
            let batch = self.tail.read(&self.path)?;
            for line in batch.lines() {
                for item in self.decoder.decode(line) {
                    if last.len() == keep {
                        last.pop_front();
                    }
                    if keep > 0 {
                        last.push_back(item);
                    }
                }
            }
            if !batch.more {
                return Ok(last.into());
            }
        }
    }

    /// Every complete line appended since the last read. A file that was
    /// truncated or replaced is read again from its start.
    fn appended(&mut self) -> io::Result<Vec<TranscriptItem>> {
        let mut items = Vec::new();
        loop {
            let batch = self.tail.read(&self.path)?;
            for line in batch.lines() {
                items.extend(self.decoder.decode(line));
            }
            if !batch.more {
                return Ok(items);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Claude,
    Codex,
}

/// Turns lines into items, pairing tool results with their calls for the
/// tool name and duration.
struct Decoder {
    format: Format,
    /// Tool call id → name and start, until its result arrives.
    open_tools: HashMap<String, (String, Timestamp)>,
}

impl Decoder {
    fn decode(&mut self, line: &[u8]) -> Vec<TranscriptItem> {
        let wanted = match self.format {
            Format::Claude => CLAUDE_WANTED,
            Format::Codex => CODEX_WANTED,
        };
        let interesting = wanted
            .iter()
            .any(|needle| line.windows(needle.len()).any(|window| window == *needle));
        if !interesting {
            return Vec::new();
        }

        let mut items = Vec::new();
        match self.format {
            Format::Claude => {
                if let Ok(record) = serde_json::from_slice::<ClaudeRecord>(line) {
                    self.claude(record, &mut items);
                }
            }
            Format::Codex => {
                if let Ok(record) = serde_json::from_slice::<CodexRecord>(line) {
                    self.codex(record, &mut items);
                }
            }
        }
        items
    }

    fn claude(&mut self, record: ClaudeRecord, items: &mut Vec<TranscriptItem>) {
        let at = record.timestamp.unwrap_or_else(Utc::now);
        let Some(content) = record.message.and_then(|message| message.content) else {
            return;
        };
        let assistant = match record.kind.as_deref() {
            Some("assistant") => true,
            Some("user") if !record.is_meta => false,
            _ => return,
        };
        let message_kind = if assistant {
            TranscriptItemKind::Assistant
        } else {
            TranscriptItemKind::User
        };

        let blocks = match content {
            ClaudeContent::Text(text) => {
                items.push(message(at, message_kind, &text));
                return;
            }
            ClaudeContent::Blocks(blocks) => blocks,
        };
        for block in blocks {
            match block {
                ClaudeBlock::Text { text } if !text.trim().is_empty() => {
                    items.push(message(at, message_kind, &text));
                }
                ClaudeBlock::ToolUse { id, name, input } => {
                    let arguments = match input {
                        serde_json::Value::Null => String::new(),
                        input => input.to_string(),
                    };
                    items.push(self.call(at, id, name, &arguments));
                }
                ClaudeBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => {
                    let text = content.map(ResultContent::into_text).unwrap_or_default();
                    items.push(self.result(at, tool_use_id, &text, is_error.unwrap_or(false)));
                }
                ClaudeBlock::Text { .. } | ClaudeBlock::Other => {}
            }
        }
    }

    fn codex(&mut self, record: CodexRecord, items: &mut Vec<TranscriptItem>) {
        if record.kind.as_deref() != Some("response_item") {
            return;
        }
        let at = record.timestamp.unwrap_or_else(Utc::now);
        let Some(payload) = record.payload else {
            return;
        };
        match payload {
            CodexPayload::Message { role, content } => {
                let kind = match role.as_str() {
                    "assistant" => TranscriptItemKind::Assistant,
                    "user" => TranscriptItemKind::User,
                    _ => return,
                };
                let text = joined(content);
                if !text.trim().is_empty() {
                    items.push(message(at, kind, &text));
                }
            }
            CodexPayload::FunctionCall {
                name,
                arguments,
                call_id,
            } => items.push(self.call(at, call_id, name, &arguments)),
            CodexPayload::CustomToolCall {
                name,
                input,
                call_id,
            } => items.push(self.call(at, call_id, name, &input)),
            CodexPayload::FunctionCallOutput { call_id, output }
            | CodexPayload::CustomToolCallOutput { call_id, output } => {
                items.push(self.result(at, call_id, &output.into_text(), false));
            }
            CodexPayload::Other => {}
        }
    }

    fn call(&mut self, at: Timestamp, id: String, name: String, arguments: &str) -> TranscriptItem {
        if self.open_tools.len() >= OPEN_TOOLS_LIMIT {
            self.open_tools.clear();
        }
        self.open_tools.insert(id.clone(), (name.clone(), at));
        TranscriptItem {
            at,
            kind: TranscriptItemKind::ToolCall,
            text: clip(arguments, TOOL_LIMIT),
            tool_id: Some(id),
            tool_name: Some(name),
            is_error: false,
            duration_ms: None,
        }
    }

    fn result(&mut self, at: Timestamp, id: String, text: &str, is_error: bool) -> TranscriptItem {
        let call = self.open_tools.remove(&id);
        let duration_ms = call
            .as_ref()
            .and_then(|(_, started)| u64::try_from((at - *started).num_milliseconds()).ok());
        TranscriptItem {
            at,
            kind: TranscriptItemKind::ToolResult,
            text: clip(text, TOOL_LIMIT),
            tool_id: Some(id),
            tool_name: call.map(|(name, _)| name),
            is_error,
            duration_ms,
        }
    }
}

fn message(at: Timestamp, kind: TranscriptItemKind, text: &str) -> TranscriptItem {
    TranscriptItem {
        at,
        kind,
        text: clip(text, MESSAGE_LIMIT),
        tool_id: None,
        tool_name: None,
        is_error: false,
        duration_ms: None,
    }
}

/// The first `limit` characters, with an ellipsis when cut.
fn clip(text: &str, limit: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(limit) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_owned(),
    }
}

/// Text blocks joined by newlines.
fn joined(blocks: Vec<TextBlock>) -> String {
    blocks
        .into_iter()
        .filter_map(|block| block.text)
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeRecord {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<Timestamp>,
    #[serde(default)]
    is_meta: bool,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    content: Option<ClaudeContent>,
}

/// A bare prompt string, or a list of blocks.
#[derive(Deserialize)]
#[serde(untagged)]
enum ClaudeContent {
    Text(String),
    Blocks(Vec<ClaudeBlock>),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClaudeBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: Option<ResultContent>,
        #[serde(default)]
        is_error: Option<bool>,
    },
    #[serde(other)]
    Other,
}

/// A tool result (Claude) or tool output (Codex): a string, or text blocks
/// among others (images).
#[derive(Deserialize)]
#[serde(untagged)]
enum ResultContent {
    Text(String),
    Blocks(Vec<TextBlock>),
    Other(serde::de::IgnoredAny),
}

impl ResultContent {
    fn into_text(self) -> String {
        match self {
            ResultContent::Text(text) => text,
            ResultContent::Blocks(blocks) => joined(blocks),
            ResultContent::Other(_) => String::new(),
        }
    }
}

/// A content block; only text blocks carry `text`.
#[derive(Deserialize)]
struct TextBlock {
    text: Option<String>,
}

#[derive(Deserialize)]
struct CodexRecord {
    timestamp: Option<Timestamp>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<CodexPayload>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CodexPayload {
    Message {
        role: String,
        #[serde(default)]
        content: Vec<TextBlock>,
    },
    FunctionCall {
        name: String,
        #[serde(default)]
        arguments: String,
        call_id: String,
    },
    CustomToolCall {
        name: String,
        #[serde(default)]
        input: String,
        call_id: String,
    },
    FunctionCallOutput {
        call_id: String,
        output: ResultContent,
    },
    CustomToolCallOutput {
        call_id: String,
        output: ResultContent,
    },
    #[serde(other)]
    Other,
}
