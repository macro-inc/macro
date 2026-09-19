//! The harness-neutral readings every [`HarnessReader`] starts from.
//!
//! These read conventions that are not any one harness's:
//!
//! - The ACP title as the tool's name.
//! - The `_meta.terminal_info` / `_meta.terminal_output` /
//!   `_meta.terminal_exit` keys, an ACP *client* extension (Zed's - a client
//!   advertises `clientCapabilities._meta.terminal_output`, as Macro's
//!   session machine does) that any agent serving that client writes,
//!   whichever harness it is: `terminal_info` on the `tool_call` names the
//!   terminal, each `terminal_output` update carries the bytes written since
//!   the last, and `terminal_exit` carries how the command ended. codex-acp
//!   writes the same stream as `terminal_output_delta` for a client that did
//!   not advertise, so that spelling is read too.
//! - A text content block as the output so far, for a harness that reports
//!   a command's output through ACP's own `content` (OpenCode streams the
//!   accumulated output that way while a command runs).
//! - The "Task tool" convention for subagents that Claude Code set and
//!   OpenCode and Cursor copied: a tool named `task`/`agent` with
//!   `{ description, prompt, subagent_type }` arguments.
//! - The `_meta._askUserQuestionCustomAnswer` marker on an elicitation
//!   form's free-text "Other" property, which Claude Code left un-namespaced
//!   on purpose so other bridges could write the same one.

use agent_client_protocol::schema::v1::ToolKind;
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, TerminalOutput, ToolFrame, mcp, namespaced, raw};
use crate::domain::model::{SubagentResult, ToolName, ToolStatus};

/// A harness this fold knows nothing specific about.
pub struct Generic;

impl HarnessReader for Generic {}

/// `_meta.terminal_info`: the terminal a call's output will stream to.
#[derive(Deserialize)]
struct TerminalInfo {
    terminal_id: String,
}

/// `_meta.terminal_output` (or `_meta.terminal_output_delta`): one write to
/// the terminal.
#[derive(Deserialize)]
struct TerminalWrite {
    data: String,
}

/// `_meta.terminal_exit`: how the command ended.
#[derive(Deserialize)]
struct TerminalExit {
    exit_code: Option<i64>,
}

/// The `_meta` key of the terminal announcement.
const TERMINAL_INFO: &str = "terminal_info";
/// The `_meta` key of a terminal write, for a client that advertised the
/// extension.
const TERMINAL_OUTPUT: &str = "terminal_output";
/// The `_meta` key codex-acp writes the same stream under for a client that
/// did not.
const TERMINAL_OUTPUT_DELTA: &str = "terminal_output_delta";
/// The `_meta` key of the exit status.
const TERMINAL_EXIT: &str = "terminal_exit";

/// The terminal a `tool_call` announces its output will stream to, by id.
///
/// Reads `_meta.terminal_info.terminal_id`.
#[must_use]
pub fn terminal_info(frame: &ToolFrame<'_>) -> Option<String> {
    namespaced::<TerminalInfo>(frame.meta, TERMINAL_INFO).map(|info| info.terminal_id)
}

/// What a frame says about a terminal call's output.
///
/// A `_meta.terminal_output` (or `terminal_output_delta`) write is a
/// [`TerminalOutput::Chunk`]: the bytes since the last frame, to append.
/// Failing that, a text content block is a [`TerminalOutput::Snapshot`]: ACP
/// replaces `content` whole on every update, so the block is the output so
/// far - except on a call still pending, where a text block can only be
/// something other than output (Claude Code puts the command's description
/// there before it runs).
#[must_use]
pub fn terminal_output(frame: &ToolFrame<'_>) -> Option<TerminalOutput> {
    if let Some(write) = namespaced::<TerminalWrite>(frame.meta, TERMINAL_OUTPUT)
        .or_else(|| namespaced::<TerminalWrite>(frame.meta, TERMINAL_OUTPUT_DELTA))
    {
        return Some(TerminalOutput::Chunk(write.data));
    }
    if matches!(frame.status, None | Some(ToolStatus::Pending)) {
        return None;
    }
    frame.content_text().map(TerminalOutput::Snapshot)
}

/// The exit code reported when a terminal-backed tool call finished.
///
/// Reads `_meta.terminal_exit.exit_code`.
#[must_use]
pub fn terminal_exit_code(frame: &ToolFrame<'_>) -> Option<i32> {
    let code = namespaced::<TerminalExit>(frame.meta, TERMINAL_EXIT)?.exit_code?;
    i32::try_from(code).ok()
}

/// The Task-tool convention: a tool named `task` or `agent` whose kind is
/// `think` (Claude Code, OpenCode) or `other` (Cursor).
#[must_use]
pub fn is_subagent(name: &ToolName, frame: &ToolFrame<'_>) -> bool {
    matches!(frame.kind, Some(ToolKind::Think | ToolKind::Other))
        && matches!(
            name.display().to_ascii_lowercase().as_str(),
            "task" | "agent"
        )
}

/// The Task-tool arguments, plus the aliases the harnesses that copied the
/// convention use: `task` for the prompt (Macro's own `Subagent`),
/// `background` for `run_in_background` (OpenCode).
#[derive(Deserialize, Default)]
struct TaskInput {
    subagent_type: Option<String>,
    description: Option<String>,
    prompt: Option<String>,
    task: Option<String>,
    run_in_background: Option<bool>,
    background: Option<bool>,
}

/// The Task-tool argument shape, read off a call's raw input.
#[must_use]
pub fn subagent_input(frame: &ToolFrame<'_>) -> SubagentInput {
    let input: TaskInput = raw(frame.raw_input).unwrap_or_default();
    SubagentInput {
        agent_type: input.subagent_type,
        description: input.description,
        prompt: input.prompt.or(input.task),
        background: input.run_in_background.or(input.background),
    }
}

/// The shared marker on an elicitation form's "Other" property.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomAnswerMarker {
    question_id: String,
    #[serde(default)]
    is_custom_answer: bool,
}

/// The select an elicitation form property is the free-text companion of,
/// by the shared marker: `_meta._askUserQuestionCustomAnswer = { questionId,
/// isCustomAnswer: true }` on the property's own schema.
#[must_use]
pub fn custom_answer_for(name: &str, property: &Value) -> Option<String> {
    let _ = name;
    let marker: CustomAnswerMarker =
        serde_json::from_value(property.get("_meta")?.get(MARKER)?.clone()).ok()?;
    marker.is_custom_answer.then_some(marker.question_id)
}

/// The `_meta` key of the shared companion marker.
pub const MARKER: &str = "_askUserQuestionCustomAnswer";

/// Whether an elicitation form property looks like a free-text "Other" box
/// by naming convention alone: a free-text string titled `Other` whose name
/// is a select's name plus `suffix`. The fallback for a recording that lost
/// its `_meta` - so a property that still carries one, whatever it says, is
/// read from that alone. Returns the select's name.
#[must_use]
pub fn custom_answer_by_suffix(name: &str, property: &Value, suffix: &str) -> Option<String> {
    if property.get("_meta").is_some() {
        return None;
    }
    let titled_other = property.get("title").and_then(Value::as_str) == Some("Other");
    let free_text = property.get("type").and_then(Value::as_str) == Some("string")
        && property.get("oneOf").is_none()
        && property.get("enum").is_none();
    (titled_other && free_text)
        .then(|| name.strip_suffix(suffix))
        .flatten()
        .filter(|target| !target.is_empty())
        .map(str::to_owned)
}

/// A bare `{ "error": … }` result, how several harnesses report a failed
/// call's output.
#[derive(Deserialize)]
struct ErrorOutput {
    error: String,
}

/// A subagent's result when the harness reports nothing structured: the
/// raw output as text, else the content blocks' text; an `{ "error" }`
/// object is a failure.
///
/// Content text counts only once the call has finished: while a delegation
/// streams, Claude Code echoes the brief there, and an echo of the question
/// is not an answer.
#[must_use]
pub fn subagent_result(frame: &ToolFrame<'_>) -> Option<SubagentResult> {
    let mut result = SubagentResult::default();
    if let Some(raw_value) = frame.raw_output {
        if let Some(ErrorOutput { error }) = raw(Some(raw_value)) {
            result.error = Some(error);
        } else {
            let (value, error) = mcp::unwrap_call_result(raw_value);
            result.error = error;
            result.text = match value {
                Value::String(text) => Some(text),
                Value::Null => None,
                other => Some(other.to_string()),
            };
        }
    }
    if result.text.is_none() && result.error.is_none() && frame.finished() {
        result.text = frame.content_text();
    }
    (!result.is_empty()).then_some(result)
}
