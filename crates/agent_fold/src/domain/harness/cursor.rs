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
//! Every external tool goes through one dispatcher tool, `mcp`, so that is
//! the only name the wire ever gives an MCP call. Which tool was really
//! called is in the arguments, beside the tool's own:
//!
//! ```json
//! { "name": "macro-ReadContent", "toolName": "ReadContent",
//!   "serverIdentifier": "macro", "providerIdentifier": "macro",
//!   "toolCallId": "call_…", "args": { "documentId": "…" } }
//! ```
//!
//! and the result is MCP's, in Cursor's spelling, under the translator's
//! `result` key: `{ "result": { "success": { "content": [{ "text": { "text":
//! "…" } }], "structuredContent": … } } }`, or one of the failure variants
//! (`error`, `rejected`, `permissionDenied`, `toolNotFound`,
//! `serverNotFound`). The reader names the call `server`/`tool`, hands the
//! fold the tool's own arguments without the dispatcher's, and unwraps the
//! result to what the tool returned, so a reader sees the exchange and not
//! the plumbing. The arguments arrive on the first update rather than the
//! announcement, so the name is patched in when they do.
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
use serde_json::{Map, Value};

use super::{HarnessReader, SubagentInput, ToolFrame, generic, mcp, raw};
use crate::domain::model::{
    AnsiText, FileDiff, MessagePart, SubagentResult, ToolDetail, ToolName, ToolStatus, ToolUseId,
};

/// Reader for Cursor's conventions.
pub struct Cursor;

/// The dispatcher tool every MCP call is made through.
const MCP_TOOL: &str = "mcp";

impl HarnessReader for Cursor {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)cursor", name)
    }

    /// An `mcp` call's real name, `server`/`tool`, once its arguments have
    /// arrived. Any other title is the name, as the generic reading has it.
    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        if frame.title.is_some_and(|title| title != MCP_TOOL) {
            return None;
        }
        McpArguments::read(frame.raw_input).map(McpArguments::into_name)
    }

    /// The tool's own arguments: for an `mcp` call, out of the dispatcher's
    /// envelope; for anything else, `rawInput` as it is.
    fn tool_input(&self, frame: &ToolFrame<'_>) -> Option<Value> {
        let raw_input = frame.raw_input?;
        Some(match McpArguments::read(Some(raw_input)) {
            Some(_) => McpArguments::tool_input(raw_input),
            None => raw_input.clone(),
        })
    }

    /// The tool's own result, out of Cursor's `{ result: { success | error |
    /// … } }` envelope - and, for an MCP call, out of MCP's content blocks
    /// in Cursor's spelling. A `rawOutput` that is not Cursor's envelope is
    /// read the neutral way.
    fn unwrap_tool_output(&self, raw: &Value) -> (Value, Option<String>) {
        match RawOutput::read(raw) {
            Some(output) => output.result.into_tool_output(),
            None => mcp::unwrap_call_result(raw),
        }
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

/// Cursor's result envelope, shared by the `task` call, every call the
/// child made, and every top-level call's `rawOutput`: `success` with the
/// payload, or `error` (`failure` for the shell tool), or for an MCP call
/// one of the ways the dispatcher can refuse (`rejected`,
/// `permissionDenied`, `toolNotFound`, `serverNotFound`), and sometimes a
/// flag beside them (`isBackground`) - hence a struct of optionals rather
/// than a one-key enum.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<Payload> {
    success: Option<Payload>,
    failure: Option<Payload>,
    error: Option<Value>,
    /// The MCP dispatcher's refusals, all read alike: the call never reached
    /// the tool, and the payload says why.
    #[serde(
        default,
        alias = "rejected",
        alias = "permissionDenied",
        alias = "toolNotFound",
        alias = "serverNotFound"
    )]
    refused: Option<Value>,
}

/// By hand rather than derived: the derive would demand `Payload: Default`,
/// and an empty envelope needs no payload.
impl<Payload> Default for Envelope<Payload> {
    fn default() -> Self {
        Self {
            success: None,
            failure: None,
            error: None,
            refused: None,
        }
    }
}

impl<Payload> Envelope<Payload> {
    fn is_reported(&self) -> bool {
        self.success.is_some() || self.failure.is_some() || self.failed()
    }

    /// Whether the envelope reports the call as not having succeeded.
    fn failed(&self) -> bool {
        self.error.is_some() || self.refused.is_some()
    }

    fn status(&self) -> ToolStatus {
        if self.success.is_some() {
            ToolStatus::Completed
        } else if self.failure.is_some() || self.failed() {
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

    /// Why the call failed, as text: the error or refusal Cursor reported.
    fn error_text(&self) -> Option<String> {
        self.error
            .as_ref()
            .or(self.refused.as_ref())
            .map(failure_text)
    }
}

impl Envelope<Value> {
    /// The tool's own result and the error text, for a call whose payload
    /// this reader has no type for: an MCP result out of its content blocks,
    /// anything else as Cursor wrote it. A failure payload (the shell tool's
    /// `{ stderr, exitCode }`) is both the result and, as text, the error.
    fn into_tool_output(self) -> (Value, Option<String>) {
        let mut error = self.error_text();
        if self.success.is_none()
            && let Some(failure) = &self.failure
        {
            error = error.or_else(|| Some(failure_text(failure)));
        }
        let Some(payload) = self.success.or(self.failure) else {
            return (Value::Null, error);
        };
        match McpSuccess::read(&payload) {
            Some(result) => {
                let (value, mcp_error) = result.into_tool_output();
                (value, error.or(mcp_error))
            }
            None => (payload, error),
        }
    }
}

/// A failure payload as text: the string it is, the message a structured
/// one carries under its usual key, else the whole thing as JSON.
fn failure_text(value: &Value) -> String {
    const MESSAGE_KEYS: &[&str] = &["error", "message", "reason", "stderr"];
    match value {
        Value::String(text) => text.clone(),
        Value::Object(fields) => MESSAGE_KEYS
            .iter()
            .find_map(|key| fields.get(*key).and_then(Value::as_str))
            .map_or_else(|| value.to_string(), str::to_owned),
        other => other.to_string(),
    }
}

// --- The `mcp` dispatcher ---

/// The `mcp` tool's arguments: which server and tool, beside the tool's own
/// arguments. Recognized by shape - `toolName` with a server identifier -
/// rather than by title alone, because the title (`mcp`) is also what a
/// child's `mcpToolCall` step is keyed by, where there is no title to read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpArguments {
    tool_name: String,
    #[serde(default)]
    server_identifier: Option<String>,
    #[serde(default)]
    provider_identifier: Option<String>,
}

impl McpArguments {
    /// The dispatcher's own keys: everything of Cursor's around the tool's
    /// arguments, per its `McpArgs` message.
    const DISPATCHER_KEYS: &'static [&'static str] = &[
        "name",
        "toolName",
        "toolCallId",
        "providerIdentifier",
        "serverIdentifier",
        "smartModeApproval",
        "smartModeApprovalOnly",
        "skipApproval",
    ];

    /// The envelope `raw_input` is, if it is one: a named tool on a named
    /// server. `None` for any other tool's arguments.
    fn read(raw_input: Option<&Value>) -> Option<Self> {
        let arguments: Self = raw(raw_input)?;
        (!arguments.tool_name.is_empty() && arguments.server().is_some()).then_some(arguments)
    }

    /// The server, by whichever identifier Cursor filled in. The two are the
    /// same string in every recording; `serverIdentifier` is the newer field.
    fn server(&self) -> Option<&str> {
        [&self.server_identifier, &self.provider_identifier]
            .into_iter()
            .flatten()
            .map(String::as_str)
            .find(|server| !server.is_empty())
    }

    fn into_name(self) -> ToolName {
        ToolName::Mcp {
            server: self.server().unwrap_or_default().to_owned(),
            tool: self.tool_name,
        }
    }

    /// The tool's own arguments, out of the dispatcher's envelope: whatever
    /// is not the dispatcher's, and - when that is Cursor's `args` map alone
    /// - the map itself. A call to a tool that takes nothing has `{}`.
    fn tool_input(raw_input: &Value) -> Value {
        let Value::Object(fields) = raw_input else {
            return raw_input.clone();
        };
        let mut own: Map<String, Value> = fields
            .iter()
            .filter(|(key, _)| !Self::DISPATCHER_KEYS.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        if own.len() == 1
            && let Some(args @ Value::Object(_)) = own.remove("args")
        {
            return args;
        }
        Value::Object(own)
    }
}

/// A top-level call's `rawOutput`: Cursor's result under the translator's
/// `result` key.
#[derive(Deserialize)]
struct RawOutput {
    result: Envelope<Value>,
}

impl RawOutput {
    /// `None` for a `rawOutput` that is not Cursor's envelope - one with no
    /// outcome under `result` at all.
    fn read(raw_output: &Value) -> Option<Self> {
        let output: Self = raw(Some(raw_output))?;
        output.result.is_reported().then_some(output)
    }
}

/// MCP's `CallToolResult` in Cursor's spelling: content items keyed by
/// their kind (`{ "text": { "text": … } }`, `{ "image": … }`) rather than
/// tagged, and - for the dispatcher's own tools - sometimes one string
/// where the items would be.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpSuccess {
    content: Option<McpContent>,
    structured_content: Option<Value>,
    #[serde(default)]
    is_error: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum McpContent {
    Items(Vec<McpContentItem>),
    Text(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum McpContentItem {
    Text(StepText),
    /// Anything that is not text - an image, a kind this reader does not
    /// know - carries nothing the fold shows.
    #[serde(untagged)]
    Other(IgnoredAny),
}

impl McpSuccess {
    /// The payload as an MCP result, if it is one. A success payload of
    /// Cursor's own tools (`{ path }`, `{ stdout }`) has neither `content`
    /// nor `structuredContent` and is not.
    fn read(payload: &Value) -> Option<Self> {
        let result: Self = raw(Some(payload))?;
        (result.content.is_some() || result.structured_content.is_some()).then_some(result)
    }

    /// The text items' text, in order.
    fn texts(&self) -> Vec<&str> {
        match &self.content {
            None => Vec::new(),
            Some(McpContent::Text(text)) => vec![text.as_str()],
            Some(McpContent::Items(items)) => items
                .iter()
                .filter_map(|item| match item {
                    McpContentItem::Text(StepText { text }) => Some(text.as_str()),
                    McpContentItem::Other(_) => None,
                })
                .collect(),
        }
    }

    /// The tool's own result, read the way [`mcp::unwrap_call_result`] reads
    /// the standard envelope: `structuredContent`; else the first text that
    /// parses as JSON; else the texts joined; else `null`. The error is the
    /// texts, when the result marks itself one.
    fn into_tool_output(self) -> (Value, Option<String>) {
        let texts = self.texts();
        let error = self.is_error.then(|| texts.join("\n"));
        if let Some(structured) = self.structured_content {
            return (structured, error);
        }
        if let Some(parsed) = texts
            .iter()
            .find_map(|text| serde_json::from_str::<Value>(text).ok())
        {
            return (parsed, error);
        }
        if texts.is_empty() {
            return (Value::Null, error);
        }
        (Value::String(texts.join("\n")), error)
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
            name,
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
    Mcp(ToolBody<Value, Value>),
}

impl Descriptor {
    /// The tool's name - in Cursor's own vocabulary (the descriptor key's
    /// stem), or for an MCP call the server and tool it dispatched to - how
    /// far it got, and what it did.
    fn into_detail(self) -> (ToolName, ToolStatus, ToolDetail) {
        if let Self::Mcp(body) = self {
            return body.into_mcp_call();
        }
        let (name, status, detail) = self.into_native_detail();
        (ToolName::native(name), status, detail)
    }

    /// Every descriptor but [`Self::Mcp`], which `into_detail` has taken.
    fn into_native_detail(self) -> (&'static str, ToolStatus, ToolDetail) {
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
            // Taken by `into_detail`; named here so the match stays
            // exhaustive when a descriptor is added.
            Self::Mcp(body) => (MCP_TOOL, body.result.status(), body.into_other()),
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
            result: None,
            error: None,
        }
    }
}

impl ToolBody<Value, Value> {
    /// A child's MCP call, read as a top-level one is: named for the server
    /// and tool, its own arguments out of the dispatcher's envelope, its
    /// result out of MCP's.
    fn into_mcp_call(self) -> (ToolName, ToolStatus, ToolDetail) {
        let status = self.result.status();
        let name = McpArguments::read(self.args.as_ref())
            .map_or_else(|| ToolName::native(MCP_TOOL), McpArguments::into_name);
        let input = self.args.as_ref().map(McpArguments::tool_input);
        let (result, error) = if self.result.is_reported() {
            match self.result.into_tool_output() {
                (Value::Null, error) => (None, error),
                (value, error) => (Some(value), error),
            }
        } else {
            (None, None)
        };
        let detail = ToolDetail::Other {
            kind: "other".to_owned(),
            output: None,
            input,
            result,
            error,
        };
        (name, status, detail)
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
                result: None,
                error: None,
            },
        }
    }
}
