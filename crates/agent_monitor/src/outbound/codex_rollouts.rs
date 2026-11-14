//! Codex rollouts: `<sessions>/YYYY/MM/DD/rollout-<time>-<session id>.jsonl`.
//!
//! Counts turns (`task_started` / `task_complete`), tool calls
//! (`function_call` and `custom_tool_call` with their outputs), token usage,
//! and pull requests opened: a call whose arguments run `gh pr create`,
//! paired with the PR URL its output printed.
//! Usage comes from per-response `token_usage_record`s; rollouts written
//! before those existed only carry running totals in `token_count` events,
//! which are turned into increases.

#[cfg(test)]
mod test;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::domain::model::{PrRef, SourceKind, Timestamp, Tokens};
use crate::domain::observation::{
    Observation, TranscriptEventKind, TranscriptKey, TranscriptProgram,
};
use crate::domain::source::{AgentSource, SourceError};
use crate::outbound::claude_transcripts::PR_CREATE;
use crate::outbound::transcripts::{self, Deltas, LineParser, TranscriptConfig, TranscriptFormat};

const ROLLOUT_PREFIX: &str = "rollout-";
const ROLLOUT_EXTENSION: &str = ".jsonl";

/// Length of the session id (a UUID) that ends a rollout's file name.
const SESSION_ID_CHARS: usize = 36;

const WANTED: &[&[u8]] = &[
    b"session_meta",
    b"turn_context",
    b"task_started",
    b"task_complete",
    b"function_call",
    b"custom_tool_call",
    b"token_count",
    b"token_usage_record",
];

/// Reads Codex rollouts under a sessions directory.
#[derive(Clone, Debug)]
pub struct CodexRolloutsSource {
    config: TranscriptConfig,
}

impl CodexRolloutsSource {
    /// Watches `sessions` (Codex's `~/.codex/sessions`) and indexes files
    /// written within `history`.
    pub fn new(sessions: PathBuf, history: Duration) -> Self {
        Self {
            config: TranscriptConfig {
                root: sessions,
                history,
            },
        }
    }
}

#[async_trait]
impl AgentSource for CodexRolloutsSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Codex
    }

    async fn run(
        self: Box<Self>,
        out: mpsc::Sender<Observation>,
        cancel: CancellationToken,
    ) -> Result<(), SourceError> {
        transcripts::run(CodexFormat, self.config, out, cancel).await
    }
}

pub(crate) struct CodexFormat;

impl TranscriptFormat for CodexFormat {
    type Parser = CodexParser;

    const SOURCE: SourceKind = SourceKind::Codex;

    fn key(&self, root: &Path, path: &Path) -> Option<TranscriptKey> {
        path.strip_prefix(root).ok()?;
        let name = path.file_name()?.to_str()?;
        let stem = name
            .strip_prefix(ROLLOUT_PREFIX)?
            .strip_suffix(ROLLOUT_EXTENSION)?;
        let start = stem.len().checked_sub(SESSION_ID_CHARS)?;
        let session = stem.get(start..)?;
        let looks_like_uuid = session
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-');
        looks_like_uuid.then(|| TranscriptKey {
            program: TranscriptProgram::Codex,
            session: session.to_owned(),
            subagent: None,
        })
    }

    fn parser(&self, _path: &Path, _key: &TranscriptKey) -> CodexParser {
        CodexParser::default()
    }
}

/// Parses one rollout.
#[derive(Default)]
pub(crate) struct CodexParser {
    /// Per-response usage records were seen; running totals are then ignored.
    saw_usage_records: bool,
    /// The last running total, to turn the next one into an increase.
    last_total: Tokens,
    /// Open calls that run `gh pr create`.
    pr_calls: BTreeSet<String>,
}

#[derive(Deserialize)]
struct Record {
    timestamp: Option<Timestamp>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    #[serde(rename = "type")]
    kind: Option<String>,
    cwd: Option<PathBuf>,
    model: Option<String>,
    git: Option<Git>,
    call_id: Option<String>,
    name: Option<String>,
    usage: Option<Usage>,
    info: Option<TokenInfo>,
    /// A `function_call`'s arguments, as a JSON string.
    arguments: Option<String>,
    /// A `custom_tool_call`'s input.
    input: Option<String>,
}

#[derive(Deserialize)]
struct Git {
    branch: Option<String>,
}

#[derive(Deserialize)]
struct TokenInfo {
    total_token_usage: Option<Usage>,
}

/// OpenAI usage: `input_tokens` includes the cached and cache-written ones.
#[derive(Deserialize)]
struct Usage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cached_input_tokens: u64,
    #[serde(default)]
    cache_write_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

impl Usage {
    fn tokens(&self) -> Tokens {
        Tokens {
            input: self
                .input_tokens
                .saturating_sub(self.cached_input_tokens)
                .saturating_sub(self.cache_write_input_tokens),
            output: self.output_tokens,
            cache_read: self.cached_input_tokens,
            cache_write: self.cache_write_input_tokens,
            cache_write_1h: 0,
        }
    }
}

impl LineParser for CodexParser {
    fn wants(&self, line: &[u8]) -> bool {
        WANTED
            .iter()
            .any(|needle| line.windows(needle.len()).any(|window| window == *needle))
    }

    fn parse(&mut self, line: &[u8], out: &mut Deltas) {
        let Ok(record) = serde_json::from_slice::<Record>(line) else {
            return;
        };
        let Some(payload) = record.payload else {
            return;
        };
        let at = record
            .timestamp
            .or_else(|| out.last_at())
            .unwrap_or_else(Utc::now);
        out.saw_time(at);
        if let Some(cwd) = payload.cwd.clone() {
            out.set_cwd(cwd);
        }

        match (record.kind.as_deref(), payload.kind.as_deref()) {
            (Some("session_meta"), _) => {
                if let Some(branch) = payload.git.and_then(|git| git.branch) {
                    out.set_branch(branch);
                }
            }
            (Some("turn_context"), _) => {
                if let Some(model) = payload.model {
                    out.set_model(model);
                }
            }
            (Some("token_usage_record"), _) => {
                if let Some(usage) = payload.usage {
                    self.saw_usage_records = true;
                    out.push(at, TranscriptEventKind::Usage(usage.tokens()));
                }
            }
            (Some("event_msg"), Some("task_started")) => {
                out.push(at, TranscriptEventKind::TurnStart);
            }
            (Some("event_msg"), Some("task_complete")) => {
                out.push(at, TranscriptEventKind::TurnEnd);
            }
            (Some("event_msg"), Some("token_count")) if !self.saw_usage_records => {
                let total = payload
                    .info
                    .and_then(|info| info.total_token_usage)
                    .map(|usage| usage.tokens());
                if let Some(total) = total {
                    let increase = increase(self.last_total, total);
                    self.last_total = total;
                    if increase.total() > 0 {
                        out.push(at, TranscriptEventKind::Usage(increase));
                    }
                }
            }
            (Some("response_item"), Some("function_call" | "custom_tool_call")) => {
                if let (Some(id), Some(name)) = (payload.call_id, payload.name) {
                    let opens_pr = [&payload.arguments, &payload.input]
                        .into_iter()
                        .flatten()
                        .any(|text| text.contains(PR_CREATE));
                    if opens_pr {
                        self.pr_calls.insert(id.clone());
                    }
                    let gist = None;
                    out.push(at, TranscriptEventKind::ToolStart { id, name, gist });
                }
            }
            (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
                if let Some(id) = payload.call_id {
                    if self.pr_calls.remove(&id)
                        && let Some(pr) = std::str::from_utf8(line).ok().and_then(PrRef::last_in)
                    {
                        out.push(at, TranscriptEventKind::PrOpened(pr));
                    }
                    // Rollouts do not mark a failed call apart from its output.
                    let is_error = false;
                    out.push(at, TranscriptEventKind::ToolEnd { id, is_error });
                }
            }
            _ => {}
        }
    }
}

fn increase(before: Tokens, after: Tokens) -> Tokens {
    Tokens {
        input: after.input.saturating_sub(before.input),
        output: after.output.saturating_sub(before.output),
        cache_read: after.cache_read.saturating_sub(before.cache_read),
        cache_write: after.cache_write.saturating_sub(before.cache_write),
        cache_write_1h: 0,
    }
}
