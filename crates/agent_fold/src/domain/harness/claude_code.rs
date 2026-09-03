//! The Claude Code harness, `@agentclientprotocol/claude-agent-acp`.
//!
//! Writes its own keys under `_meta.claudeCode`, read as [`ClaudeCodeMeta`]:
//!
//! - `toolName` - the harness's name for the tool (`Bash`, `Read`, `Write`,
//!   or `mcp__<server>__<tool>` for an MCP tool).
//! - `subagent: true` - on the `Agent` tool call that delegates work.
//! - `parentToolUseId` - on a call the subagent made, naming the `Agent`
//!   call it belongs to. Present on the opening frame; not on every patch.
//! - `toolResponse` - the tool's own result object, richer than the text
//!   blocks `rawOutput` later carries. For `Agent` it is an
//!   [`AgentResponse`]: the subagent's answer, id, model, timings, token
//!   count and per-tool statistics.

use agent_client_protocol::schema::v1::{ContentBlock, Meta};
use lazy_regex::regex_is_match;
use serde::Deserialize;
use serde_json::Value;

use super::{HarnessReader, ToolFrame, generic, has_namespace, namespaced, raw};
use crate::domain::model::{SubagentResult, ToolName, ToolStats, ToolUseId};

/// The `_meta` namespace Claude Code writes under.
pub const NAMESPACE: &str = "claudeCode";

/// Reader for Claude Code's conventions.
pub struct ClaudeCode;

/// `_meta.claudeCode`, as far as the fold reads it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeMeta {
    tool_name: Option<String>,
    #[serde(default)]
    subagent: bool,
    parent_tool_use_id: Option<String>,
    tool_response: Option<Value>,
}

fn meta_of(meta: Option<&Meta>) -> ClaudeCodeMeta {
    namespaced(meta, NAMESPACE).unwrap_or_default()
}

/// The `Agent` tool's `toolResponse`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentResponse {
    status: Option<String>,
    error: Option<String>,
    #[serde(default)]
    content: Vec<ContentBlock>,
    agent_id: Option<String>,
    resolved_model: Option<String>,
    total_duration_ms: Option<u32>,
    total_tokens: Option<u32>,
    total_tool_use_count: Option<u32>,
    tool_stats: Option<AgentToolStats>,
}

/// The `Agent` tool's `toolStats`, in Claude Code's names.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolStats {
    #[serde(default)]
    read_count: u32,
    #[serde(default)]
    search_count: u32,
    #[serde(default)]
    bash_count: u32,
    #[serde(default)]
    edit_file_count: u32,
    #[serde(default)]
    lines_added: u32,
    #[serde(default)]
    lines_removed: u32,
    #[serde(default)]
    other_tool_count: u32,
}

impl From<AgentToolStats> for ToolStats {
    fn from(stats: AgentToolStats) -> Self {
        Self {
            reads: stats.read_count,
            searches: stats.search_count,
            commands: stats.bash_count,
            edits: stats.edit_file_count,
            lines_added: stats.lines_added,
            lines_removed: stats.lines_removed,
            other: stats.other_tool_count,
        }
    }
}

impl From<AgentResponse> for SubagentResult {
    fn from(response: AgentResponse) -> Self {
        let text = response
            .content
            .iter()
            .filter_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
        let failed = response.status.as_deref() == Some("failed");
        Self {
            text: (!text.is_empty()).then_some(text),
            error: failed.then(|| {
                response
                    .error
                    .unwrap_or_else(|| "subagent failed".to_owned())
            }),
            agent_id: response.agent_id,
            model: response.resolved_model,
            duration_ms: response.total_duration_ms,
            tokens: response.total_tokens,
            tool_uses: response.total_tool_use_count,
            stats: response.tool_stats.map(ToolStats::from),
        }
    }
}

impl HarnessReader for ClaudeCode {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)claude", name)
    }

    fn wrote(&self, frame: &ToolFrame<'_>) -> bool {
        has_namespace(frame.meta, NAMESPACE)
    }

    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        tool_name(frame.meta).map(|name| name.parse().unwrap_or_else(|never| match never {}))
    }

    fn is_subagent(&self, name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        meta_of(frame.meta).subagent || generic::is_subagent(name, frame)
    }

    fn parent_tool_call(&self, frame: &ToolFrame<'_>) -> Option<ToolUseId> {
        meta_of(frame.meta).parent_tool_use_id.map(ToolUseId)
    }

    fn subagent_result(&self, frame: &ToolFrame<'_>) -> Option<SubagentResult> {
        if let Some(response) = meta_of(frame.meta).tool_response {
            // The response object is what the harness says about the run;
            // one that does not read as an `AgentResponse` still says nothing
            // the generic path would not.
            if let Ok(response) = serde_json::from_value::<AgentResponse>(response) {
                return Some(response.into());
            }
        }
        // The final frame copies the answer into `rawOutput` as content
        // blocks, the second of which is an "agentId: ... <usage>" boilerplate
        // the response object already said better. Keep the first.
        let first_text = raw::<Vec<ContentBlock>>(frame.raw_output).and_then(|blocks| {
            blocks.into_iter().find_map(|block| match block {
                ContentBlock::Text(text) => Some(text.text),
                _ => None,
            })
        });
        match first_text {
            Some(text) => Some(SubagentResult {
                text: Some(text),
                ..SubagentResult::default()
            }),
            None => generic::subagent_result(frame),
        }
    }
}

/// The harness's own name for the tool behind a `tool_call`, verbatim.
///
/// Reads `_meta.claudeCode.toolName`.
#[must_use]
pub fn tool_name(meta: Option<&Meta>) -> Option<String> {
    meta_of(meta).tool_name
}
