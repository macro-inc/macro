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
//! (`subagentType` is a proto-oneof: sometimes `{ "explore": {} }`, sometimes
//! `{ "kind": "explore" }` or `{ "kind": "custom", "name": "…" }`.) The child's
//! activity is not attributed to the parent, and the call's result is usually
//! truncated out of the `tool_call` event the translator reads today.

use agent_client_protocol::schema::v1::Meta;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic};
use crate::domain::model::SubagentResult;

/// Reader for Cursor's conventions.
pub struct Cursor;

impl HarnessReader for Cursor {
    fn subagent_input(&self, raw_input: Option<&Value>, _title: &str) -> SubagentInput {
        let mut input = generic::subagent_input(raw_input);
        if input.agent_type.is_none() {
            input.agent_type = raw_input
                .and_then(|input| input.get("subagentType"))
                .and_then(subagent_type);
        }
        input
    }

    fn subagent_result(
        &self,
        _meta: Option<&Meta>,
        raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let mut result = generic::subagent_result(raw_output, content_text).unwrap_or_default();
        let string = |key: &str| {
            raw_input?
                .get(key)?
                .as_str()
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        };
        result.agent_id = string("agentId").or(result.agent_id);
        result.model = string("model").or(result.model);
        (!result.is_empty()).then_some(result)
    }
}

/// The agent type out of Cursor's `subagentType` oneof.
fn subagent_type(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    if let Some(name) = object.get("name").and_then(Value::as_str) {
        return Some(name.to_owned());
    }
    if let Some(kind) = object.get("kind").and_then(Value::as_str) {
        return Some(kind.to_owned());
    }
    object.keys().next().cloned()
}
