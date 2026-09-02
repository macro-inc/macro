//! The harness-neutral readings every [`HarnessReader`] starts from.
//!
//! These read conventions that are not any one harness's:
//!
//! - The ACP title as the tool's name.
//! - The `_meta.terminal_output` / `_meta.terminal_exit` keys, an ACP
//!   *client* extension (Zed's - a client advertises
//!   `clientCapabilities._meta.terminal_output`) that any agent serving that
//!   client writes, whichever harness it is.
//! - The "Task tool" convention for subagents that Claude Code set and
//!   OpenCode and Cursor copied: a tool named `task`/`agent` with
//!   `{ description, prompt, subagent_type }` arguments.

use agent_client_protocol::schema::v1::{Meta, ToolKind};
use serde_json::Value;

use super::{HarnessReader, SubagentInput, mcp};
use crate::domain::model::{SubagentResult, ToolName};

/// A harness this fold knows nothing specific about.
pub struct Generic;

impl HarnessReader for Generic {}

/// A chunk of terminal output carried on a `tool_call_update`.
///
/// Reads `_meta.terminal_output.data`. Each update carries the output
/// accumulated so far rather than only the new bytes, so callers should
/// replace rather than append.
#[must_use]
pub fn terminal_output(meta: Option<&Meta>) -> Option<String> {
    meta?
        .get("terminal_output")?
        .get("data")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// The exit code reported when a terminal-backed tool call finished.
///
/// Reads `_meta.terminal_exit.exit_code`.
#[must_use]
pub fn terminal_exit_code(meta: Option<&Meta>) -> Option<i32> {
    let code = meta?.get("terminal_exit")?.get("exit_code")?.as_i64()?;
    i32::try_from(code).ok()
}

/// The Task-tool convention: a tool named `task` or `agent` whose kind is
/// `think` (Claude Code, OpenCode) or `other` (Cursor).
#[must_use]
pub fn is_subagent(name: &ToolName, kind: ToolKind) -> bool {
    matches!(kind, ToolKind::Think | ToolKind::Other)
        && matches!(
            name.display().to_ascii_lowercase().as_str(),
            "task" | "agent"
        )
}

/// The Task-tool argument shape, plus the aliases the harnesses that copied
/// it use: `task` for the prompt (Macro's own `Subagent`), `background` for
/// `run_in_background` (OpenCode).
#[must_use]
pub fn subagent_input(raw_input: Option<&Value>) -> SubagentInput {
    let Some(input) = raw_input.and_then(Value::as_object) else {
        return SubagentInput::default();
    };
    let string = |key: &str| {
        input
            .get(key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    };
    SubagentInput {
        agent_type: string("subagent_type"),
        description: string("description"),
        prompt: string("prompt").or_else(|| string("task")),
        background: input
            .get("run_in_background")
            .or_else(|| input.get("background"))
            .and_then(Value::as_bool),
    }
}

/// A subagent's result when the harness reports nothing structured: the
/// raw output as text, else the content blocks' text; a `{ "error" }`
/// object is a failure.
#[must_use]
pub fn subagent_result(
    raw_output: Option<&Value>,
    content_text: Option<&str>,
) -> Option<SubagentResult> {
    let mut result = SubagentResult::default();
    if let Some(raw) = raw_output {
        if let Some(error) = raw.get("error").and_then(Value::as_str) {
            result.error = Some(error.to_owned());
        } else {
            let (value, error) = mcp::unwrap_call_result(raw);
            result.error = error;
            result.text = match value {
                Value::String(text) => Some(text),
                Value::Null => None,
                other => Some(other.to_string()),
            };
        }
    }
    if result.text.is_none() && result.error.is_none() {
        result.text = content_text.map(ToOwned::to_owned);
    }
    (!result.is_empty()).then_some(result)
}
