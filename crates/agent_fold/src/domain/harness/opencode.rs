//! OpenCode, whose ACP server is built in (`agentInfo.name = "OpenCode"`).
//!
//! Writes no `_meta` on tool frames. Its subagent tool is `task`, kind
//! `think`, with the Task-tool arguments; the child runs as a separate
//! OpenCode session whose activity is never streamed into the parent. What
//! the parent sees is the completion:
//!
//! ```json
//! { "output": "<task id=\"ses_…\" state=\"completed\">\n<task_result>\n…\n</task_result>\n</task>",
//!   "metadata": { "parentSessionId": "ses_…", "sessionId": "ses_…",
//!                 "model": { "modelID": "…", "providerID": "…" }, "truncated": false } }
//! ```
//!
//! or, on failure, `{ "error": "…", "metadata": { … } }`.

use lazy_regex::regex_captures;
use serde_json::Value;

use super::{HarnessReader, generic};
use crate::domain::model::SubagentResult;

/// Reader for OpenCode's conventions.
pub struct OpenCode;

impl HarnessReader for OpenCode {
    fn subagent_result(
        &self,
        _meta: Option<&agent_client_protocol::schema::v1::Meta>,
        _raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let Some(raw) = raw_output.and_then(Value::as_object) else {
            return generic::subagent_result(raw_output, content_text);
        };
        let metadata = raw.get("metadata");
        let string_at =
            |value: Option<&Value>, key: &str| value?.get(key)?.as_str().map(ToOwned::to_owned);
        let result = SubagentResult {
            text: raw
                .get("output")
                .and_then(Value::as_str)
                .map(task_result_text),
            error: string_at(Some(&Value::Object(raw.clone())), "error"),
            agent_id: string_at(metadata, "sessionId"),
            model: metadata
                .and_then(|metadata| metadata.get("model"))
                .and_then(|model| {
                    let provider = model.get("providerID")?.as_str()?;
                    let id = model.get("modelID")?.as_str()?;
                    Some(format!("{provider}/{id}"))
                }),
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
