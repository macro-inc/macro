//! OpenCode, whose ACP server is built in (`agentInfo.name = "OpenCode"`).
//!
//! Writes no `_meta` on tool frames. Its subagent tool is `task`, kind
//! `think`, with the Task-tool arguments; the child runs as a separate
//! OpenCode session whose activity is never streamed into the parent. What
//! the parent sees is the completion, read as [`TaskOutput`]:
//!
//! ```json
//! { "output": "<task id=\"ses_…\" state=\"completed\">\n<task_result>\n…\n</task_result>\n</task>",
//!   "metadata": { "parentSessionId": "ses_…", "sessionId": "ses_…",
//!                 "model": { "modelID": "…", "providerID": "…" }, "truncated": false } }
//! ```
//!
//! or, on failure, `{ "error": "…", "metadata": { … } }`.

use lazy_regex::{regex_captures, regex_is_match};
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, ToolFrame, generic, raw};
use crate::domain::model::SubagentResult;

/// Reader for OpenCode's conventions.
pub struct OpenCode;

/// The `task` tool's `rawOutput`.
#[derive(Debug, Deserialize)]
struct TaskOutput {
    output: Option<String>,
    error: Option<String>,
    metadata: Option<TaskMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskMetadata {
    session_id: Option<String>,
    model: Option<TaskModel>,
}

#[derive(Debug, Deserialize)]
struct TaskModel {
    #[serde(rename = "providerID")]
    provider_id: String,
    #[serde(rename = "modelID")]
    model_id: String,
}

impl HarnessReader for OpenCode {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)^opencode", name)
    }

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        let raw_output = frame.raw_output;
        let Some(output) =
            raw::<TaskOutput>(raw_output).filter(|_| raw_output.is_some_and(Value::is_object))
        else {
            return generic::subagent_result(frame);
        };
        let metadata = output.metadata;
        let result = SubagentResult {
            text: output.output.as_deref().map(task_result_text),
            error: output.error,
            agent_id: metadata.as_ref().and_then(|meta| meta.session_id.clone()),
            model: metadata
                .and_then(|meta| meta.model)
                .map(|model| format!("{}/{}", model.provider_id, model.model_id)),
            ..SubagentResult::default()
        };
        (!result.is_empty()).then_some(result)
    }
}

/// The answer inside OpenCode's `<task …><task_result>…</task_result></task>`
/// wrapper, or the text untouched when it is not wrapped.
#[must_use]
pub fn task_result_text(output: &str) -> String {
    match regex_captures!(
        r"(?s)<task_(?:result|error)>\s*(.*?)\s*</task_(?:result|error)>",
        output
    ) {
        Some((_, inner)) => inner.to_owned(),
        None => output.to_owned(),
    }
}
