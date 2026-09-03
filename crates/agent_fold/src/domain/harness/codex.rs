//! OpenAI Codex through the `@agentclientprotocol/codex-acp` adapter
//! (`agentInfo.name = "@agentclientprotocol/codex-acp"`; the deprecated Rust
//! adapter announced `codex-acp` and emitted nothing for subagents).
//!
//! Writes its own keys under `_meta.codex` ([`CodexMeta`]), and two flat flags:
//!
//! - `_meta.is_mcp_tool_call: true` with the title `mcp.<server>.<tool>` -
//!   how it names an MCP tool, where Claude Code uses `mcp__<server>__<tool>`.
//! - `_meta.codex.collaboration = { tool, senderThreadId, receiverThreadIds }`
//!   on the collaboration tools. `tool: "spawnAgent"` is the delegation; the
//!   others (`sendInput`, `wait`, `closeAgent`, …) steer an existing one.
//!
//! A `spawnAgent` call is `kind: other`, titled `spawnAgent` for its whole
//! life, and carries its state in `rawInput` ([`SpawnAgentInput`]) - there is
//! no `rawOutput`. The child's own activity is not streamed into the parent
//! session by this (legacy) mode; the adapter's native-subagent mode uses
//! `sessionUpdate` variants ACP has not standardized, which this fold does
//! not read yet.

use std::collections::BTreeMap;

use agent_client_protocol::schema::v1::Meta;
use lazy_regex::{regex_captures, regex_is_match};
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, ToolFrame, generic, has_namespace, namespaced, raw};
use crate::domain::model::{SubagentResult, ToolName};

/// The `_meta` namespace codex-acp writes under.
pub const NAMESPACE: &str = "codex";

/// Reader for codex-acp's conventions.
pub struct Codex;

/// `_meta.codex`, as far as the fold reads it.
#[derive(Debug, Default, Deserialize)]
struct CodexMeta {
    collaboration: Option<Collaboration>,
}

#[derive(Debug, Deserialize)]
struct Collaboration {
    tool: String,
}

/// `_meta` flags codex-acp writes at the top level.
#[derive(Debug, Default, Deserialize)]
struct CodexFlags {
    #[serde(default)]
    is_mcp_tool_call: bool,
}

/// `spawnAgent`'s `rawInput`, which is also where its result lives.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnAgentInput {
    prompt: Option<String>,
    #[serde(default)]
    receiver_thread_ids: Vec<String>,
    #[serde(default)]
    agents_states: BTreeMap<String, AgentState>,
    model: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentState {
    message: Option<String>,
}

fn flags_of(meta: Option<&Meta>) -> CodexFlags {
    meta.and_then(|meta| serde_json::from_value(Value::Object(meta.clone())).ok())
        .unwrap_or_default()
}

impl HarnessReader for Codex {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)codex", name)
    }

    /// Either of its `_meta` signals: the namespace, or the flat MCP flag it
    /// writes on MCP calls whether or not the namespace is present.
    fn wrote(&self, frame: &ToolFrame<'_>) -> bool {
        has_namespace(frame.meta, NAMESPACE) || flags_of(frame.meta).is_mcp_tool_call
    }

    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        if !flags_of(frame.meta).is_mcp_tool_call {
            return None;
        }
        regex_captures!(r"^mcp\.([^.]+)\.(.+)$", frame.title?).map(|(_, server, tool)| {
            ToolName::Mcp {
                server: server.to_owned(),
                tool: tool.to_owned(),
            }
        })
    }

    fn is_subagent(&self, _name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        namespaced::<CodexMeta>(frame.meta, NAMESPACE)
            .and_then(|meta| meta.collaboration)
            .is_some_and(|collaboration| collaboration.tool == "spawnAgent")
    }

    fn subagent_input(&self, frame: &ToolFrame<'_>) -> SubagentInput {
        SubagentInput {
            prompt: raw::<SpawnAgentInput>(frame.raw_input).and_then(|input| input.prompt),
            ..SubagentInput::default()
        }
    }

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        let Some(input) = raw::<SpawnAgentInput>(frame.raw_input) else {
            return generic::subagent_result(frame);
        };
        let child = input.receiver_thread_ids.first().cloned();
        let message = child
            .as_ref()
            .and_then(|child| input.agents_states.get(child))
            .and_then(|state| state.message.clone());
        let failed = input.status.as_deref() == Some("failed");
        let result = SubagentResult {
            text: if failed { None } else { message.clone() },
            error: failed.then(|| message.unwrap_or_else(|| "subagent failed".to_owned())),
            agent_id: child,
            model: input.model.filter(|model| !model.is_empty()),
            ..SubagentResult::default()
        };
        (!result.is_empty()).then_some(result)
    }
}
