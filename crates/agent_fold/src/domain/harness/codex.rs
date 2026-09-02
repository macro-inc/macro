//! OpenAI Codex through the `@agentclientprotocol/codex-acp` adapter
//! (`agentInfo.name = "@agentclientprotocol/codex-acp"`; the deprecated Rust
//! adapter announced `codex-acp` and emitted nothing for subagents).
//!
//! Writes its own keys under `_meta.codex`, and two flat flags:
//!
//! - `_meta.is_mcp_tool_call: true` with the title `mcp.<server>.<tool>` -
//!   how it names an MCP tool, where Claude Code uses `mcp__<server>__<tool>`.
//! - `_meta.codex.collaboration = { tool, senderThreadId, receiverThreadIds }`
//!   on the collaboration tools. `tool: "spawnAgent"` is the delegation; the
//!   others (`sendInput`, `wait`, `closeAgent`, …) steer an existing one.
//!
//! A `spawnAgent` call is `kind: other`, titled `spawnAgent` for its whole
//! life, and carries its state in `rawInput` - there is no `rawOutput`:
//!
//! ```json
//! { "prompt": "…", "senderThreadId": "…", "receiverThreadIds": ["<child>"],
//!   "agentsStates": { "<child>": { "status": "completed", "message": "…" } },
//!   "model": "…", "reasoningEffort": "…", "status": "completed" }
//! ```
//!
//! The child's own activity is not streamed into the parent session by this
//! (legacy) mode; the adapter's native-subagent mode uses `sessionUpdate`
//! variants ACP has not standardized, which this fold does not read yet.

use agent_client_protocol::schema::v1::{Meta, ToolKind};
use lazy_regex::regex_captures;
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic, namespace};
use crate::domain::model::{SubagentResult, ToolName};

/// The `_meta` namespace codex-acp writes under.
pub const NAMESPACE: &str = "codex";

/// Reader for codex-acp's conventions.
pub struct Codex;

impl HarnessReader for Codex {
    fn meta_namespace(&self) -> Option<&'static str> {
        Some(NAMESPACE)
    }

    fn harness_tool_name(&self, meta: Option<&Meta>, title: &str) -> Option<ToolName> {
        let is_mcp = meta?
            .get("is_mcp_tool_call")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !is_mcp {
            return None;
        }
        regex_captures!(r"^mcp\.([^.]+)\.(.+)$", title).map(|(_, server, tool)| ToolName::Mcp {
            server: server.to_owned(),
            tool: tool.to_owned(),
        })
    }

    fn is_subagent(&self, _name: &ToolName, _kind: ToolKind, meta: Option<&Meta>) -> bool {
        collaboration_tool(meta) == Some("spawnAgent")
    }

    fn subagent_input(&self, raw_input: Option<&Value>, _title: &str) -> SubagentInput {
        SubagentInput {
            prompt: raw_input
                .and_then(|input| input.get("prompt"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            ..SubagentInput::default()
        }
    }

    fn subagent_result(
        &self,
        _meta: Option<&Meta>,
        raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        let Some(input) = raw_input else {
            return generic::subagent_result(raw_output, content_text);
        };
        let child = input
            .get("receiverThreadIds")
            .and_then(Value::as_array)
            .and_then(|ids| ids.first())
            .and_then(Value::as_str);
        let state = child.and_then(|child| input.get("agentsStates")?.get(child));
        let status = input.get("status").and_then(Value::as_str);
        let message = state
            .and_then(|state| state.get("message"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let result = SubagentResult {
            text: if status == Some("failed") {
                None
            } else {
                message.clone()
            },
            error: (status == Some("failed"))
                .then(|| message.unwrap_or_else(|| "subagent failed".to_owned())),
            agent_id: child.map(ToOwned::to_owned),
            model: input
                .get("model")
                .and_then(Value::as_str)
                .filter(|model| !model.is_empty())
                .map(ToOwned::to_owned),
            ..SubagentResult::default()
        };
        (!result.is_empty()).then_some(result)
    }
}

/// Which collaboration tool a frame is, per `_meta.codex.collaboration.tool`.
fn collaboration_tool(meta: Option<&Meta>) -> Option<&str> {
    namespace(meta, NAMESPACE)?
        .get("collaboration")?
        .get("tool")?
        .as_str()
}
