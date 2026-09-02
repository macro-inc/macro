//! The Claude Code harness, `@agentclientprotocol/claude-agent-acp`.
//!
//! Writes its own keys under `_meta.claudeCode`:
//!
//! - `toolName` - the harness's name for the tool (`Bash`, `Read`, `Write`,
//!   or `mcp__<server>__<tool>` for an MCP tool).

use agent_client_protocol::schema::v1::Meta;

use super::{HarnessReader, namespace};
use crate::domain::model::ToolName;

/// The `_meta` namespace Claude Code writes under.
pub const NAMESPACE: &str = "claudeCode";

/// Reader for Claude Code's conventions.
pub struct ClaudeCode;

impl HarnessReader for ClaudeCode {
    fn meta_namespace(&self) -> Option<&'static str> {
        Some(NAMESPACE)
    }

    fn meta_tool_name(&self, meta: Option<&Meta>) -> Option<ToolName> {
        tool_name(meta).map(|name| name.parse().unwrap_or_else(|never| match never {}))
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
