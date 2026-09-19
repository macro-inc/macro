//! OpenClaw's ACP gateway (`agentInfo.name = "openclaw-acp"`).
//!
//! Writes no `_meta` on tool frames. Every tool call is titled
//! `<tool>: key: value, key: value…` with the arguments in `rawInput`. Its
//! delegation tool is `sessions_spawn`, kind `other` ([`SpawnArgs`]):
//!
//! ```json
//! { "task": "…", "label": "…", "agentId": "…", "runtime": "subagent" }
//! ```
//!
//! Completion means the spawn was *accepted*, not that the subagent
//! finished; the answer arrives later as a message. The result names the
//! child session ([`SpawnDetails`]):
//!
//! ```json
//! { "content": [{ "type": "text", "text": "{…}" }],
//!   "details": { "status": "accepted", "childSessionKey": "agent:main:subagent:…", "runId": "…" } }
//! ```

use lazy_regex::{regex_captures, regex_is_match};
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, ToolFrame, generic, mcp, raw};
use crate::domain::model::{SubagentResult, ToolName};

/// Reader for OpenClaw's conventions.
pub struct OpenClaw;

/// `sessions_spawn`'s arguments, beyond the Task-tool ones the generic
/// reader takes (`task` as the prompt).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnArgs {
    label: Option<String>,
    agent_id: Option<String>,
    runtime: Option<String>,
}

/// `sessions_spawn`'s result, wherever it sits: the `details` object, or the
/// same JSON as the text block's content.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnDetails {
    child_session_key: Option<String>,
    run_id: Option<String>,
    error: Option<String>,
}

/// A `rawOutput` that carries `details` beside its content blocks.
#[derive(Debug, Deserialize)]
struct DetailedOutput {
    details: SpawnDetails,
}

impl HarnessReader for OpenClaw {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)openclaw", name)
    }

    /// `<tool>: key: value…` - the tool is what comes before the first colon.
    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        regex_captures!(r"^([a-z][a-z0-9_]*):\s", frame.title?)
            .map(|(_, tool)| ToolName::native(tool))
    }

    fn is_subagent(&self, name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        name.display() == "sessions_spawn" || generic::is_subagent(name, frame)
    }

    fn subagent_input(&self, frame: &ToolFrame<'_>) -> SubagentInput {
        let mut input = generic::subagent_input(frame);
        let args: SpawnArgs = raw(frame.raw_input).unwrap_or_default();
        if input.description.is_none() {
            input.description = args.label;
        }
        if input.agent_type.is_none() {
            input.agent_type = args.agent_id.or(args.runtime);
        }
        input
    }

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        let Some(raw_output) = frame.raw_output else {
            return generic::subagent_result(frame);
        };
        let details = match raw::<DetailedOutput>(Some(raw_output)) {
            Some(output) => output.details,
            // Without `details`, the text block's JSON says the same.
            None => match mcp::unwrap_call_result(raw_output).0 {
                Value::String(text) => serde_json::from_str(&text).unwrap_or_default(),
                value => serde_json::from_value(value).unwrap_or_default(),
            },
        };
        let result = SubagentResult {
            agent_id: details.child_session_key.or(details.run_id),
            error: details.error,
            // An accepted spawn has no answer yet; that arrives as a message.
            text: None,
            ..SubagentResult::default()
        };
        (!result.is_empty()).then_some(result)
    }
}
