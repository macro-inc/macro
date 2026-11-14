//! Claude Code transcripts: `<projects>/<project>/<session>.jsonl`, and each
//! subagent's `<project>/<session>/subagents/agent-<id>.jsonl` with its
//! `agent-<id>.meta.json` beside it.
//!
//! Counts turns, tool calls and errors, token usage per model response (a
//! response is written as one line per content block, all with the same
//! usage, so usage is counted once per message id), the session's reported
//! cost (`cost-state.totalCostUSD`, a running total that includes its
//! subagents) and its title. Every field is optional: the layout is not a
//! contract.

#[cfg(test)]
mod test;

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{Cost, SourceKind, Timestamp, Tokens};
use crate::domain::observation::{
    Observation, TranscriptEventKind, TranscriptKey, TranscriptProgram,
};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::transcripts::{self, Deltas, LineParser, TranscriptConfig, TranscriptFormat};

const SUBAGENTS_DIR: &str = "subagents";
const SUBAGENT_PREFIX: &str = "agent-";
const TRANSCRIPT_EXTENSION: &str = "jsonl";

/// The model id Claude Code writes on messages it made up itself.
const SYNTHETIC_MODEL: &str = "<synthetic>";

/// Stop reasons that end a turn (anything but a pause for a tool call).
const TURN_ENDING_STOPS: &[&str] = &["end_turn", "stop_sequence", "max_tokens", "refusal"];

/// Lines worth parsing; everything else (snapshots, request shapes, modes) is
/// skipped before decoding.
const WANTED: &[&[u8]] = &[
    b"\"type\":\"assistant\"",
    b"\"type\":\"user\"",
    b"\"cost-state\"",
    b"\"ai-title\"",
];

/// Reads Claude Code transcripts under a projects directory.
#[derive(Clone, Debug)]
pub struct ClaudeTranscriptsSource {
    config: TranscriptConfig,
}

impl ClaudeTranscriptsSource {
    /// Watches `projects` (Claude Code's `~/.claude/projects`) and indexes
    /// files written within `history`.
    pub fn new(projects: PathBuf, history: Duration) -> Self {
        Self {
            config: TranscriptConfig {
                root: projects,
                history,
            },
        }
    }
}

#[async_trait]
impl AgentSource for ClaudeTranscriptsSource {
    fn kind(&self) -> SourceKind {
        SourceKind::ClaudeTranscripts
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        transcripts::run(ClaudeFormat, self.config, out, cancel).await
    }
}

pub(crate) struct ClaudeFormat;

impl TranscriptFormat for ClaudeFormat {
    type Parser = ClaudeParser;

    const SOURCE: SourceKind = SourceKind::ClaudeTranscripts;

    fn key(&self, root: &Path, path: &Path) -> Option<TranscriptKey> {
        let relative = path.strip_prefix(root).ok()?;
        let parts: Vec<&str> = relative
            .components()
            .map(|component| match component {
                Component::Normal(part) => part.to_str(),
                _ => None,
            })
            .collect::<Option<_>>()?;

        let stem = |file: &str| {
            let (stem, extension) = file.rsplit_once('.')?;
            (extension == TRANSCRIPT_EXTENSION && !stem.is_empty()).then(|| stem.to_owned())
        };
        let (session, subagent) = match parts.as_slice() {
            [_project, file] => (stem(file)?, None),
            [_project, session, SUBAGENTS_DIR, file] => {
                let agent = stem(file)?.strip_prefix(SUBAGENT_PREFIX)?.to_owned();
                ((*session).to_owned(), Some(agent))
            }
            _ => return None,
        };
        Some(TranscriptKey {
            program: TranscriptProgram::Claude,
            session,
            subagent,
        })
    }

    fn parser(&self, path: &Path, key: &TranscriptKey) -> ClaudeParser {
        let title = key
            .subagent
            .as_ref()
            .and_then(|_| subagent_description(path));
        ClaudeParser {
            pending_title: title,
            last_message: None,
        }
    }
}

#[derive(Deserialize)]
struct SubagentMeta {
    description: Option<String>,
}

/// The task a subagent was given, from the `.meta.json` beside its transcript.
fn subagent_description(path: &Path) -> Option<String> {
    let meta = path.with_extension("meta.json");
    let text = std::fs::read(meta).ok()?;
    let meta: SubagentMeta = serde_json::from_slice(&text).ok()?;
    meta.description
        .filter(|description| !description.is_empty())
}

/// Parses one Claude Code transcript.
pub(crate) struct ClaudeParser {
    /// A title known before the first line (a subagent's description).
    pending_title: Option<String>,
    /// The id of the last assistant message seen; its later lines repeat it.
    last_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<Timestamp>,
    cwd: Option<PathBuf>,
    git_branch: Option<String>,
    #[serde(default)]
    is_meta: bool,
    message: Option<Message>,
    ai_title: Option<String>,
    #[serde(rename = "totalCostUSD")]
    total_cost_usd: Option<f64>,
}

#[derive(Deserialize)]
struct Message {
    id: Option<String>,
    model: Option<String>,
    stop_reason: Option<String>,
    usage: Option<Usage>,
    content: Option<Content>,
}

/// A message's content: a list of blocks, or a bare prompt string. Blocks go
/// first because an ignored value matches anything.
#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Blocks(Vec<Block>),
    Text(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Block {
    Text,
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: Option<ToolInput>,
    },
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        is_error: Option<bool>,
    },
    #[serde(other)]
    Other,
}

/// The few tool arguments a gist is made from; the rest are never decoded.
#[derive(Deserialize)]
struct ToolInput {
    file_path: Option<String>,
    notebook_path: Option<String>,
    path: Option<String>,
    command: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    cache_creation: Option<CacheCreation>,
}

#[derive(Deserialize)]
struct CacheCreation {
    #[serde(default)]
    ephemeral_1h_input_tokens: u64,
}

impl LineParser for ClaudeParser {
    fn wants(&self, line: &[u8]) -> bool {
        WANTED
            .iter()
            .any(|needle| line.windows(needle.len()).any(|window| window == *needle))
    }

    fn parse(&mut self, line: &[u8], out: &mut Deltas) {
        if let Some(title) = self.pending_title.take() {
            out.set_title(title);
        }
        let Ok(record) = serde_json::from_slice::<Record>(line) else {
            return;
        };
        if let Some(at) = record.timestamp {
            out.saw_time(at);
        }
        if let Some(cwd) = record.cwd {
            out.set_cwd(cwd);
        }
        if let Some(branch) = record.git_branch.filter(|branch| !branch.is_empty()) {
            out.set_branch(branch);
        }

        let at = record
            .timestamp
            .or_else(|| out.last_at())
            .unwrap_or_else(Utc::now);
        match record.kind.as_deref() {
            Some("assistant") => {
                if let Some(message) = record.message {
                    self.assistant(message, at, out);
                }
            }
            Some("user") if !record.is_meta => {
                if let Some(content) = record.message.and_then(|message| message.content) {
                    user(content, at, out);
                }
            }
            Some("ai-title") => {
                if let Some(title) = record.ai_title.filter(|title| !title.is_empty()) {
                    out.set_title(title);
                }
            }
            Some("cost-state") => {
                if let Some(usd) = record.total_cost_usd {
                    out.push(at, TranscriptEventKind::Cost(Cost::Known(usd)));
                }
            }
            _ => {}
        }
    }
}

impl ClaudeParser {
    fn assistant(&mut self, message: Message, at: Timestamp, out: &mut Deltas) {
        let model = message
            .model
            .filter(|model| model != SYNTHETIC_MODEL && !model.is_empty());
        let first_line = message.id.is_none() || message.id != self.last_message;
        self.last_message.clone_from(&message.id);

        if first_line && let Some(model) = model {
            out.set_model(model);
            if let Some(usage) = message.usage {
                out.push(at, TranscriptEventKind::Usage(tokens(&usage)));
            }
        }

        if let Some(Content::Blocks(blocks)) = message.content {
            for block in blocks {
                if let Block::ToolUse { id, name, input } = block {
                    let gist = input.as_ref().and_then(gist);
                    out.push(at, TranscriptEventKind::ToolStart { id, name, gist });
                }
            }
        }

        let ends_turn = message
            .stop_reason
            .as_deref()
            .is_some_and(|reason| TURN_ENDING_STOPS.contains(&reason));
        if first_line && ends_turn {
            out.push(at, TranscriptEventKind::TurnEnd);
        }
    }
}

/// A user record starts a turn when it carries a prompt, and ends tool calls
/// for each tool result it carries.
fn user(content: Content, at: Timestamp, out: &mut Deltas) {
    let blocks = match content {
        Content::Text(_) => {
            out.push(at, TranscriptEventKind::TurnStart);
            return;
        }
        Content::Blocks(blocks) => blocks,
    };

    let mut prompt = false;
    for block in blocks {
        match block {
            Block::ToolResult {
                tool_use_id,
                is_error,
            } => out.push(
                at,
                TranscriptEventKind::ToolEnd {
                    id: tool_use_id,
                    is_error: is_error.unwrap_or(false),
                },
            ),
            Block::Text => prompt = true,
            Block::ToolUse { .. } | Block::Other => {}
        }
    }
    if prompt {
        out.push(at, TranscriptEventKind::TurnStart);
    }
}

fn tokens(usage: &Usage) -> Tokens {
    Tokens {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_read: usage.cache_read_input_tokens,
        cache_write: usage.cache_creation_input_tokens,
        cache_write_1h: usage
            .cache_creation
            .as_ref()
            .map_or(0, |creation| creation.ephemeral_1h_input_tokens),
    }
}

/// A short gist of a tool call's target: the file name it touches, or the
/// program a command runs. Never the arguments themselves.
fn gist(input: &ToolInput) -> Option<String> {
    let file = input
        .file_path
        .as_deref()
        .or(input.notebook_path.as_deref())
        .or(input.path.as_deref());
    if let Some(file) = file {
        return Path::new(file)
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned);
    }

    let program = input.command.as_deref()?.split_whitespace().next()?;
    Path::new(program)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}
