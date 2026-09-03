//! Cursor cloud agents, through this repository's `cursor_cloud_agents`
//! translator (`agentInfo.name = "cursor-acp"`).
//!
//! The translator writes no `_meta`. Cursor's subagent tool is `task`, kind
//! `other`, with the Task-tool arguments in Cursor's own spelling
//! ([`TaskArgs`]):
//!
//! ```json
//! { "description": "…", "prompt": "…", "subagentType": { "explore": {} },
//!   "model": "composer-2.5-fast", "agentId": "bc-…" }
//! ```
//!
//! `subagentType` is a proto-oneof ([`SubagentType`]): sometimes
//! `{ "explore": {} }`, sometimes `{ "kind": "explore" }` or
//! `{ "kind": "custom", "name": "…" }`. The child's activity is not attributed
//! to the parent, and the call's result is usually truncated out of the
//! `tool_call` event the translator reads today.

use std::collections::BTreeMap;

use agent_client_protocol::schema::v1::Meta;
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic, raw};
use crate::domain::model::SubagentResult;

/// Reader for Cursor's conventions.
pub struct Cursor;

/// The `task` tool's arguments, in Cursor's spelling.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskArgs {
    subagent_type: Option<SubagentType>,
    model: Option<String>,
    agent_id: Option<String>,
}

/// Cursor's `subagentType` oneof, in the two spellings the wire uses.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SubagentType {
    /// `{ "kind": "explore" }`, or `{ "kind": "custom", "name": "reviewer" }`.
    Kinded { kind: String, name: Option<String> },
    /// `{ "explore": {} }` - the variant's name is the one key.
    Flag(BTreeMap<String, Value>),
}

impl SubagentType {
    fn name(self) -> Option<String> {
        match self {
            Self::Kinded { kind, name } => Some(name.unwrap_or(kind)),
            Self::Flag(map) => map.into_keys().next(),
        }
    }
}

impl HarnessReader for Cursor {
    fn subagent_input(&self, raw_input: Option<&Value>, _title: &str) -> SubagentInput {
        let mut input = generic::subagent_input(raw_input);
        if input.agent_type.is_none() {
            input.agent_type = raw::<TaskArgs>(raw_input)
                .and_then(|args| args.subagent_type)
                .and_then(SubagentType::name);
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
        let args: TaskArgs = raw(raw_input).unwrap_or_default();
        let non_empty = |value: Option<String>| value.filter(|value| !value.is_empty());
        result.agent_id = non_empty(args.agent_id).or(result.agent_id);
        result.model = non_empty(args.model).or(result.model);
        (!result.is_empty()).then_some(result)
    }
}
