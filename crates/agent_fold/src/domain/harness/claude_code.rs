//! The Claude Code harness, `@agentclientprotocol/claude-agent-acp`.
//!
//! Writes its own keys under `_meta.claudeCode`:
//!
//! - `toolName` - the harness's name for the tool (`Bash`, `Read`, `Write`,
//!   or `mcp__<server>__<tool>` for an MCP tool).
//! - `subagent: true` - on the `Agent` tool call that delegates work.
//! - `parentToolUseId` - on a call the subagent made, naming the `Agent`
//!   call it belongs to. Present on the opening frame; not on every patch.
//! - `toolResponse` - the tool's own result object, richer than the text
//!   blocks `rawOutput` later carries. For `Agent` it holds the subagent's
//!   answer, id, model, timings, token count and per-tool statistics.

use agent_client_protocol::schema::v1::{Meta, ToolKind};
use serde_json::Value;

use super::{HarnessReader, SubagentInput, generic, namespace};
use crate::domain::model::{SubagentResult, ToolName, ToolStats, ToolUseId};

/// The `_meta` namespace Claude Code writes under.
pub const NAMESPACE: &str = "claudeCode";

/// Reader for Claude Code's conventions.
pub struct ClaudeCode;

impl HarnessReader for ClaudeCode {
    fn meta_namespace(&self) -> Option<&'static str> {
        Some(NAMESPACE)
    }

    fn harness_tool_name(&self, meta: Option<&Meta>, _title: &str) -> Option<ToolName> {
        tool_name(meta).map(|name| name.parse().unwrap_or_else(|never| match never {}))
    }

    fn is_subagent(&self, name: &ToolName, kind: ToolKind, meta: Option<&Meta>) -> bool {
        namespace(meta, NAMESPACE)
            .and_then(|meta| meta.get("subagent"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || generic::is_subagent(name, kind)
    }

    fn parent_tool_call(&self, meta: Option<&Meta>) -> Option<ToolUseId> {
        namespace(meta, NAMESPACE)?
            .get("parentToolUseId")?
            .as_str()
            .map(|id| ToolUseId(id.to_owned()))
    }

    fn subagent_input(&self, raw_input: Option<&Value>, _title: &str) -> SubagentInput {
        generic::subagent_input(raw_input)
    }

    fn subagent_result(
        &self,
        meta: Option<&Meta>,
        _raw_input: Option<&Value>,
        raw_output: Option<&Value>,
        content_text: Option<&str>,
    ) -> Option<SubagentResult> {
        if let Some(response) = namespace(meta, NAMESPACE).and_then(|meta| meta.get("toolResponse"))
        {
            return Some(agent_result(response));
        }
        // The final frame copies the answer into `rawOutput` as text blocks,
        // the second of which is an "agentId: ... <usage>" boilerplate the
        // response object already said better. Keep the first.
        let text = raw_output
            .and_then(Value::as_array)
            .and_then(|blocks| blocks.first())
            .and_then(|block| block.get("text"))
            .and_then(Value::as_str);
        match text {
            Some(text) => Some(SubagentResult {
                text: Some(text.to_owned()),
                ..SubagentResult::default()
            }),
            None => generic::subagent_result(raw_output, content_text),
        }
    }
}

/// The harness's own name for the tool behind a `tool_call`, verbatim.
///
/// Reads `_meta.claudeCode.toolName`.
#[must_use]
pub fn tool_name(meta: Option<&Meta>) -> Option<String> {
    namespace(meta, NAMESPACE)?
        .get("toolName")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// The `Agent` tool's response object, in the fold's vocabulary.
fn agent_result(response: &Value) -> SubagentResult {
    let text = response
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.is_empty());
    let string = |key: &str| {
        response
            .get(key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    };
    let u64_at = |key: &str| response.get(key).and_then(Value::as_u64);
    SubagentResult {
        text,
        error: (response.get("status").and_then(Value::as_str) == Some("failed"))
            .then(|| string("error").unwrap_or_else(|| "subagent failed".to_owned())),
        agent_id: string("agentId"),
        model: string("resolvedModel"),
        duration_ms: u64_at("totalDurationMs"),
        tokens: u64_at("totalTokens"),
        tool_uses: u64_at("totalToolUseCount").and_then(|count| u32::try_from(count).ok()),
        stats: response.get("toolStats").map(tool_stats),
    }
}

fn tool_stats(stats: &Value) -> ToolStats {
    let count = |key: &str| {
        stats
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|count| u32::try_from(count).ok())
            .unwrap_or(0)
    };
    ToolStats {
        reads: count("readCount"),
        searches: count("searchCount"),
        commands: count("bashCount"),
        edits: count("editFileCount"),
        lines_added: count("linesAdded"),
        lines_removed: count("linesRemoved"),
        other: count("otherToolCount"),
    }
}
