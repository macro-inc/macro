//! Codex rollouts: `<sessions>/YYYY/MM/DD/rollout-<time>-<session id>.jsonl`.
//!
//! Counts turns (`task_started` / `task_complete`), tool calls
//! (`function_call` and `custom_tool_call` with their outputs), token usage,
//! and pull requests opened: a call whose command runs `gh pr create`
//! (`outbound::pr_create`), paired with the PR URL its own output printed
//! unless that output reports a non-zero exit code.
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
use crate::outbound::pr_create::invokes_pr_create;
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
                    let opens_pr = payload
                        .arguments
                        .as_deref()
                        .is_some_and(arguments_run_pr_create)
                        || payload.input.as_deref().is_some_and(input_runs_pr_create);
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
                        && let Some(output) = output_text(line)
                        && !reports_failure(&output)
                        && let Some(pr) = PrRef::last_in(&output)
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

/// Whether a `function_call`'s JSON arguments run `gh pr create`: its `cmd`
/// (`exec_command`) or `command` (`shell`, text or an argument list).
fn arguments_run_pr_create(arguments: &str) -> bool {
    let Ok(arguments) = serde_json::from_str::<CallArguments>(arguments) else {
        return false;
    };
    let command = match arguments.command {
        Some(CallCommand::Text(text)) => invokes_pr_create(&text),
        Some(CallCommand::Argv(argv)) => {
            argv.last().is_some_and(|last| invokes_pr_create(last))
                || invokes_pr_create(&argv.join(" "))
        }
        None => false,
    };
    command || arguments.cmd.as_deref().is_some_and(invokes_pr_create)
}

/// Whether a `custom_tool_call`'s input runs `gh pr create`: as shell text,
/// or in a `cmd: "..."` string of a code-mode script.
fn input_runs_pr_create(input: &str) -> bool {
    invokes_pr_create(input)
        || lazy_regex::regex!(r#"\bcmd\s*:\s*("(?:[^"\\]|\\.)*")"#)
            .captures_iter(input)
            .filter_map(|captures| serde_json::from_str::<String>(captures.get(1)?.as_str()).ok())
            .any(|command| invokes_pr_create(&command))
}

/// Whether a call's output reports a non-zero exit code (a failed
/// `gh pr create` prints the URL of the pull request that already exists).
fn reports_failure(output: &str) -> bool {
    lazy_regex::regex!(r#"(?:exit_code"?\s*:\s*|Process exited with code |Exit code:\s*)(\d+)"#)
        .captures_iter(output)
        .any(|captures| captures.get(1).is_some_and(|code| code.as_str() != "0"))
}

/// The output text of the call output record on this line, decoded only for
/// a `gh pr create` call.
fn output_text(line: &[u8]) -> Option<String> {
    let record: OutputRecord = serde_json::from_slice(line).ok()?;
    Some(match record.payload?.output? {
        CallOutput::Text(text) => text,
        CallOutput::Blocks(blocks) => blocks
            .into_iter()
            .filter_map(|block| block.text)
            .collect::<Vec<_>>()
            .join("\n"),
    })
}

#[derive(Deserialize)]
struct CallArguments {
    cmd: Option<String>,
    command: Option<CallCommand>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum CallCommand {
    Text(String),
    Argv(Vec<String>),
}

#[derive(Deserialize)]
struct OutputRecord {
    payload: Option<OutputPayload>,
}

#[derive(Deserialize)]
struct OutputPayload {
    output: Option<CallOutput>,
}

/// A call's output: text, or text blocks.
#[derive(Deserialize)]
#[serde(untagged)]
enum CallOutput {
    Text(String),
    Blocks(Vec<OutputBlock>),
}

#[derive(Deserialize)]
struct OutputBlock {
    text: Option<String>,
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
