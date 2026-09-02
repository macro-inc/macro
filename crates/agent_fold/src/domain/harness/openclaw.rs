//! OpenClaw's ACP gateway (`agentInfo.name = "openclaw-acp"`).
//!
//! Writes no `_meta` on tool frames. Every tool call is titled
//! `<tool>: key: value, key: value…` with the arguments in `rawInput`. Its
//! delegation tool is `sessions_spawn`, kind `other`:
//!
//! ```json
//! { "task": "…", "label": "…", "agentId": "…", "runtime": "subagent" }
//! ```
//!
//! Completion means the spawn was *accepted*, not that the subagent
//! finished; the answer arrives later as a message. The result names the
//! child session:
//!
//! ```json
//! { "content": [{ "type": "text", "text": "{…}" }],
//!   "details": { "status": "accepted", "childSessionKey": "agent:main:subagent:…", "runId": "…" } }
//! ```

use agent_client_protocol::schema::v1::{Meta, ToolKind};
use lazy_regex::regex_captures;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic};
use crate::domain::model::{SubagentResult, ToolName};

/// Reader for OpenClaw's conventions.
pub struct OpenClaw;

impl HarnessReader for OpenClaw {
    /// `<tool>: key: value…` - the tool is what comes before the first colon.
    fn harness_tool_name(&self, _meta: Option<&Meta>, title: &str) -> Option<ToolName> {
        regex_captures!(r"^([a-z][a-z0-9_]*):\s", title).map(|(_, tool)| ToolName::native(tool))
    }

    fn is_subagent(&self, name: &ToolName, kind: ToolKind, _meta: Option<&Meta>) -> bool {
        name.display() == "sessions_spawn" || generic::is_subagent(name, kind)
    }

    fn subagent_input(&self, raw_input: Option<&Value>, _title: &str) -> SubagentInput {
        let mut input = generic::subagent_input(raw_input);
        let string = |key: &str| raw_input?.get(key)?.as_str().map(ToOwned::to_owned);
        if input.description.is_none() {
            input.description = string("label");
        }
        if input.agent_type.is_none() {
            input.agent_type = string("agentId").or_else(|| string("runtime"));
        }
        input
    }

    fn subagent_result(
        &self,
        _meta: Option<&Meta>,
        _raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let Some(raw) = raw_output else {
            return generic::subagent_result(None, content_text);
        };
        let details = raw.get("details").cloned().unwrap_or_else(|| {
            generic::subagent_result(Some(raw), None)
                .and_then(|result| result.text)
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .unwrap_or(Value::Null)
        });
        let string = |key: &str| details.get(key)?.as_str().map(ToOwned::to_owned);
        let result = SubagentResult {
            agent_id: string("childSessionKey").or_else(|| string("runId")),
            error: string("error"),
            // An accepted spawn has no answer yet; that arrives as a message.
            text: None,
            ..SubagentResult::default()
        };
        (!result.is_empty()).then_some(result)
    }
}
