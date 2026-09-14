//! Cursor cloud agents, through this repository's `cursor_cloud_agents`
//! translator (`agentInfo.name = "cursor-acp"`).
//!
//! The translator writes no `_meta`. Cursor's subagent tool is `task`, kind
//! `other`, with the Task-tool arguments in Cursor's own spelling:
//!
//! ```json
//! { "description": "…", "prompt": "…", "subagentType": { "explore": {} },
//!   "model": "composer-2.5-fast", "agentId": "bc-…" }
//! ```
//!
//! `subagentType` is a proto-oneof: sometimes `{ "explore": {} }`, sometimes
//! `{ "kind": "explore" }` or `{ "kind": "custom", "name": "…" }`, and
//! `{ "unspecified": {} }` (with `"model": "default"`) when the agent left
//! both to Cursor - proto defaults, not information.
//!
//! The child's activity is never streamed as frames of its own. Instead the
//! finished call carries the child's whole transcript, wrapped by the
//! translator under `rawOutput.result`:
//!
//! ```json
//! { "result": { "success": {
//!     "agentId": "bc-…", "durationMs": "12978",
//!     "conversationSteps": [
//!       { "thinkingMessage": { "text": "…", "durationMs": 1168 } },
//!       { "assistantMessage": { "text": "…" } },
//!       { "toolCall": { "toolCallId": "call_…\nfc_…",
//!                       "shellToolCall": { "args": { "command": "…" },
//!                                          "result": { "success": { "stdout": "…" },
//!                                                      "isBackground": false } } } },
//!       { "assistantMessage": { "text": "the answer" } }
//!     ] } } }
//! ```
//!
//! or `{ "result": { "error": … } }`. Numbers Cursor declares as 64-bit
//! arrive as JSON strings, proto's encoding for them. The reader folds the
//! steps into the subagent's children and takes the closing prose as its
//! answer, so the transcript reads like the child had streamed.
//!
//! Every shape is a serde type below and read by deserializing, never by
//! walking `Value`s. A field the types do not name is ignored; a frame they
//! cannot read is "no information", same as every reader. Proto oneofs are
//! enums keyed by their variant, and proto envelopes that may carry a flag
//! beside the payload (`isBackground`) are structs of optionals.

use std::collections::BTreeMap;

use lazy_regex::regex_is_match;
use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, ToolFrame, generic, raw};
use crate::domain::model::{
    AnsiText, FileDiff, MessagePart, SubagentResult, ToolDetail, ToolName, ToolStatus, ToolUseId,
};

/// Reader for Cursor's conventions.
pub struct Cursor;

impl HarnessReader for Cursor {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)cursor", name)
    }

    fn subagent_input(&self, frame: &ToolFrame<'_>) -> SubagentInput {
        let mut input = generic::subagent_input(frame);
        if input.agent_type.is_none() {
            input.agent_type = TaskArguments::read(frame.raw_input)
                .and_then(|arguments| arguments.subagent_type)
                .and_then(SubagentType::name);
        }
        input
    }

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        let mut result = match TaskOutput::read(frame.raw_output) {
            Some(output) => output.result.into_subagent_result(),
            None => generic::subagent_result(frame).unwrap_or_default(),
        };
        if let Some(arguments) = TaskArguments::read(frame.raw_input) {
            result.agent_id = arguments.agent_id.or(result.agent_id);
            result.model = arguments.model.or(result.model);
        }
        (!result.is_empty()).then_some(result)
    }

    fn subagent_transcript(&self, frame: &ToolFrame<'_>) -> Vec<MessagePart> {
        TaskOutput::read(frame.raw_output)
            .and_then(|output| output.result.success)
            .map(Transcript::into_parts)
            .unwrap_or_default()
    }
}

/// A string that says something, else `None`. Cursor writes `""` for a field
/// it has nothing for, and `"default"` for a model it chose itself.
fn informative(text: Option<String>) -> Option<String> {
    text.filter(|text| !text.is_empty() && text != "default")
}

/// A count Cursor may encode as a number or, for its 64-bit fields, a
/// string. Saturates rather than drops a count past `u32`: the browser
/// contract forbids 64-bit integers, and a clamped 49 days beats a vanished
/// duration.
fn lenient_u32<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<u32>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Count {
        Number(u64),
        Text(String),
        Other(IgnoredAny),
    }
    let saturate = |count: u64| u32::try_from(count).unwrap_or(u32::MAX);
    Ok(match Option::<Count>::deserialize(deserializer)? {
        Some(Count::Number(count)) => Some(saturate(count)),
        Some(Count::Text(text)) => text.parse().ok().map(saturate),
        Some(Count::Other(_)) | None => None,
    })
}

/// Cursor call ids embed a literal newline (`call_…\nfc_…`); the translator
/// collapses it for top-level ids, and nested ids get the same treatment.
fn collapse_whitespace(id: &str) -> String {
    id.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- The `task` call's arguments ---

/// The `task` tool's arguments, as far as this reader wants them. The
/// Task-tool fields (`description`, `prompt`) are read by [`generic`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskArguments {
    subagent_type: Option<SubagentType>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
}

impl TaskArguments {
    fn read(raw_input: Option<&Value>) -> Option<Self> {
        let mut arguments: Self = raw(raw_input)?;
        arguments.model = informative(arguments.model);
        arguments.agent_id = informative(arguments.agent_id);
        Some(arguments)
    }
}

/// Cursor's `subagentType` oneof, in each spelling it has been seen in.
#[derive(Deserialize)]
#[serde(untagged)]
enum SubagentType {
    /// `{ "kind": "explore" }` or `{ "kind": "custom", "name": "reviewer" }`.
    Kinded {
        kind: String,
        #[serde(default)]
        name: Option<String>,
    },
    /// `{ "explore": {} }` - the variant is the key.
    Keyed(BTreeMap<String, IgnoredAny>),
}

impl SubagentType {
    /// The agent type's name; `None` for the proto default `unspecified`.
    fn name(self) -> Option<String> {
        let name = match self {
            Self::Kinded { kind, name } => name.unwrap_or(kind),
            Self::Keyed(variants) => variants.into_keys().next()?,
        };
        (name != "unspecified").then_some(name)
    }
}

// --- The `task` call's result ---

/// `rawOutput` of a finished `task` call: Cursor's result under the
/// translator's `result` key.
#[derive(Deserialize)]
struct TaskOutput {
    result: Envelope<Transcript>,
}

impl TaskOutput {
    /// `None` for a `rawOutput` that is not a `task` result at all - one
    /// with neither `success` nor `error` under `result`.
    fn read(raw_output: Option<&Value>) -> Option<Self> {
        let output: Self = raw(raw_output)?;
        output.result.is_reported().then_some(output)
    }
}

/// Cursor's result envelope, shared by the `task` call and every call the
/// child made: `success` with the payload, or `error` (`failure` for the
/// shell tool), and sometimes a flag beside them (`isBackground`) - hence a
/// struct of optionals rather than a one-key enum.
#[derive(Deserialize)]
struct Envelope<Payload> {
    success: Option<Payload>,
    failure: Option<Payload>,
    error: Option<Value>,
}

/// By hand rather than derived: the derive would demand `Payload: Default`,
/// and an empty envelope needs no payload.
impl<Payload> Default for Envelope<Payload> {
    fn default() -> Self {
        Self {
            success: None,
            failure: None,
            error: None,
        }
    }
}

impl<Payload> Envelope<Payload> {
    fn is_reported(&self) -> bool {
        self.success.is_some() || self.failure.is_some() || self.error.is_some()
    }

    fn status(&self) -> ToolStatus {
        if self.success.is_some() {
            ToolStatus::Completed
        } else if self.failure.is_some() || self.error.is_some() {
            ToolStatus::Failed
        } else {
            // Nothing recorded: not evidence either way.
            ToolStatus::Pending
        }
    }

    /// Whichever payload was written, successful or not.
    fn payload(&self) -> Option<&Payload> {
        self.success.as_ref().or(self.failure.as_ref())
    }

    fn error_text(&self) -> Option<String> {
        Some(match self.error.as_ref()? {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
    }
}

impl Envelope<Transcript> {
    fn into_subagent_result(self) -> SubagentResult {
        if let Some(error) = self.error_text() {
            return SubagentResult {
                error: Some(error),
                ..SubagentResult::default()
            };
        }
        self.success
            .or(self.failure)
            .map(Transcript::into_subagent_result)
            .unwrap_or_default()
    }
}

/// What a finished child reports: who it was, how long it took, and every
/// step it took.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transcript {
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default, deserialize_with = "lenient_u32")]
    duration_ms: Option<u32>,
    #[serde(default)]
    conversation_steps: Vec<Step>,
}

impl Transcript {
    /// The child's answer: its final step, when that is prose.
    fn answer(&self) -> Option<&str> {
        match self.conversation_steps.last()? {
            Step::AssistantMessage(message) if !message.text.is_empty() => Some(&message.text),
            _ => None,
        }
    }

    fn into_subagent_result(self) -> SubagentResult {
        SubagentResult {
            text: self.answer().map(ToOwned::to_owned),
            agent_id: informative(self.agent_id.clone()),
            duration_ms: self.duration_ms,
            tool_uses: u32::try_from(
                self.conversation_steps
                    .iter()
                    .filter(|step| matches!(step, Step::ToolCall(_)))
                    .count(),
            )
            .ok(),
            ..SubagentResult::default()
        }
    }

    /// The child's work as parts: every step but the closing prose, which
    /// is the answer and reported in the result instead.
    fn into_parts(mut self) -> Vec<MessagePart> {
        if self.answer().is_some() {
            self.conversation_steps.pop();
        }
        self.conversation_steps
            .into_iter()
            .filter_map(Step::into_part)
            .collect()
    }
}

/// One step of the child's transcript: a proto oneof keyed by step kind.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Step {
    ThinkingMessage(StepText),
    AssistantMessage(StepText),
    ToolCall(Box<ToolCallStep>),
    /// A step kind this reader does not know; kept so one unknown step does
    /// not fail the whole transcript.
    #[serde(untagged)]
    Unrecognized(IgnoredAny),
}

impl Step {
    fn into_part(self) -> Option<MessagePart> {
        match self {
            Self::ThinkingMessage(StepText { text }) if !text.is_empty() => {
                Some(MessagePart::Thought { text })
            }
            Self::AssistantMessage(StepText { text }) if !text.is_empty() => {
                Some(MessagePart::Text { text })
            }
            Self::ToolCall(call) => Some(call.into_part()),
            Self::ThinkingMessage(_) | Self::AssistantMessage(_) | Self::Unrecognized(_) => None,
        }
    }
}

#[derive(Deserialize)]
struct StepText {
    #[serde(default)]
    text: String,
}

// --- The calls the child made ---

/// A `toolCall` step: the call's id beside a descriptor oneof keyed by tool.
/// A descriptor this reader knows is read typed; one it does not is kept by
/// name alone, so a new Cursor tool still shows up as a call rather than
/// vanishing from the transcript.
#[derive(Deserialize)]
#[serde(untagged)]
enum ToolCallStep {
    Known(Box<KnownToolCall>),
    Unknown(UnknownToolCall),
}

impl ToolCallStep {
    fn into_part(self) -> MessagePart {
        match self {
            Self::Known(call) => call.into_part(),
            Self::Unknown(call) => call.into_part(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnownToolCall {
    #[serde(default)]
    tool_call_id: String,
    #[serde(flatten)]
    descriptor: Descriptor,
}

impl KnownToolCall {
    fn into_part(self) -> MessagePart {
        let (name, status, detail) = self.descriptor.into_detail();
        MessagePart::ToolUse {
            id: ToolUseId(collapse_whitespace(&self.tool_call_id)),
            name: ToolName::native(name),
            status,
            detail,
        }
    }
}

/// Cursor's tool descriptor oneof. The variants mirror the typed
/// descriptors the translator maps at top level (`kind_from_cursor_type`),
/// so a nested call renders like the same call would there. Each holds the
/// tool's own arguments and result payload.
#[derive(Deserialize)]
enum Descriptor {
    #[serde(rename = "shellToolCall")]
    Shell(ToolBody<ShellArguments, ShellOutcome>),
    #[serde(rename = "readToolCall")]
    Read(ToolBody<PathArguments, PathOutcome>),
    #[serde(rename = "editToolCall")]
    Edit(ToolBody<PathArguments, EditOutcome>),
    #[serde(rename = "deleteToolCall")]
    Delete(ToolBody<PathArguments, PathOutcome>),
    #[serde(rename = "grepToolCall")]
    Grep(ToolBody<PathArguments, PathOutcome>),
    #[serde(rename = "globToolCall")]
    Glob(ToolBody<PathArguments, PathOutcome>),
    #[serde(rename = "updateTodosToolCall")]
    UpdateTodos(ToolBody<Value, IgnoredAny>),
    #[serde(rename = "taskToolCall")]
    Task(ToolBody<Value, IgnoredAny>),
    #[serde(rename = "mcpToolCall")]
    Mcp(ToolBody<Value, IgnoredAny>),
}

impl Descriptor {
    /// The tool's name in Cursor's own vocabulary (the descriptor key's
    /// stem), how far it got, and what it did.
    fn into_detail(self) -> (&'static str, ToolStatus, ToolDetail) {
        match self {
            Self::Shell(body) => {
                let status = body.result.status();
                let outcome = body.result.payload();
                let detail = ToolDetail::Terminal {
                    command: body.args.and_then(|args| args.command),
                    output: outcome.and_then(ShellOutcome::output).map(AnsiText),
                    exit_code: match (&body.result.success, &body.result.failure) {
                        (Some(_), _) => Some(0),
                        (None, Some(failure)) => failure.exit_code,
                        (None, None) => None,
                    },
                };
                ("shell", status, detail)
            }
            Self::Read(body) => {
                let (status, paths) = body.status_and_paths();
                ("read", status, ToolDetail::Read { paths })
            }
            Self::Delete(body) => {
                let (status, paths) = body.status_and_paths();
                ("delete", status, ToolDetail::Delete { paths })
            }
            Self::Grep(body) => {
                let (status, paths) = body.status_and_paths();
                (
                    "grep",
                    status,
                    ToolDetail::Search {
                        paths,
                        output: None,
                    },
                )
            }
            Self::Glob(body) => {
                let (status, paths) = body.status_and_paths();
                (
                    "glob",
                    status,
                    ToolDetail::Search {
                        paths,
                        output: None,
                    },
                )
            }
            Self::Edit(body) => {
                let status = body.result.status();
                let diffs = body
                    .result
                    .success
                    .and_then(EditOutcome::into_diff)
                    .into_iter()
                    .collect();
                ("edit", status, ToolDetail::Edit { diffs })
            }
            Self::UpdateTodos(body) => (
                "updateTodos",
                body.result.status(),
                ToolDetail::Think { output: None },
            ),
            Self::Task(body) => ("task", body.result.status(), body.into_other()),
            Self::Mcp(body) => ("mcp", body.result.status(), body.into_other()),
        }
    }
}

/// A descriptor's body: what the child asked for and what it got.
#[derive(Deserialize)]
// Spelled out because the derive would otherwise infer `Default` bounds on
// both parameters from the `default` below, which the payload types lack.
#[serde(bound(deserialize = "Arguments: Deserialize<'de>, Outcome: Deserialize<'de>"))]
struct ToolBody<Arguments, Outcome> {
    args: Option<Arguments>,
    #[serde(default)]
    result: Envelope<Outcome>,
}

impl<Arguments, Outcome> ToolBody<Arguments, Outcome> {
    fn status(&self) -> ToolStatus {
        self.result.status()
    }
}

impl<Outcome> ToolBody<Value, Outcome> {
    /// A tool with no rendering of its own: its arguments, verbatim.
    fn into_other(self) -> ToolDetail {
        ToolDetail::Other {
            kind: "other".to_owned(),
            output: None,
            input: self.args,
        }
    }
}

impl ToolBody<PathArguments, PathOutcome> {
    /// The path the call touched - from its result once finished, from its
    /// arguments before.
    fn status_and_paths(self) -> (ToolStatus, Vec<std::path::PathBuf>) {
        let status = self.status();
        let path = self
            .result
            .payload()
            .and_then(|outcome| outcome.path.clone())
            .or(self.args.and_then(|args| args.path));
        (status, path.map(Into::into).into_iter().collect())
    }
}

#[derive(Deserialize)]
struct ShellArguments {
    #[serde(default)]
    command: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellOutcome {
    #[serde(default)]
    stdout: Option<String>,
    #[serde(default)]
    stderr: Option<String>,
    #[serde(default)]
    interleaved_output: Option<String>,
    #[serde(default)]
    exit_code: Option<i32>,
}

impl ShellOutcome {
    /// The output as the terminal showed it, else whichever stream it wrote.
    fn output(&self) -> Option<String> {
        self.interleaved_output
            .clone()
            .or_else(|| self.stdout.clone())
            .or_else(|| self.stderr.clone())
    }
}

#[derive(Deserialize)]
struct PathArguments {
    #[serde(default)]
    path: Option<String>,
}

#[derive(Deserialize)]
struct PathOutcome {
    #[serde(default)]
    path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditOutcome {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    before_full_file_content: Option<String>,
    #[serde(default)]
    after_full_file_content: Option<String>,
}

impl EditOutcome {
    /// A finished edit's whole-file diff. `beforeFullFileContent` is absent
    /// exactly when the file is new, which is what `old_text: None` means.
    fn into_diff(self) -> Option<FileDiff> {
        Some(FileDiff {
            path: self.path?.into(),
            old_text: self.before_full_file_content,
            new_text: self.after_full_file_content?,
        })
    }
}

/// A `toolCall` step whose descriptor this reader has no type for. Only
/// the variant's name is read - the key ending in `ToolCall` - so the call
/// still appears, as an `other` with nothing inside.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnknownToolCall {
    #[serde(default)]
    tool_call_id: String,
    #[serde(flatten)]
    rest: BTreeMap<String, IgnoredAny>,
}

impl UnknownToolCall {
    fn into_part(self) -> MessagePart {
        let name = self
            .rest
            .into_keys()
            .find(|key| key.ends_with("ToolCall"))
            .map(|key| key.trim_end_matches("ToolCall").to_owned())
            .unwrap_or_default();
        MessagePart::ToolUse {
            id: ToolUseId(collapse_whitespace(&self.tool_call_id)),
            name: ToolName::native(name),
            status: ToolStatus::Pending,
            detail: ToolDetail::Other {
                kind: "other".to_owned(),
                output: None,
                input: None,
            },
        }
    }
}
