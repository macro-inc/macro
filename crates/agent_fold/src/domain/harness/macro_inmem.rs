//! Macro's own in-process agent, `agent_inmem`.
//!
//! The one harness this repository writes as well as reads, so it labels its
//! frames rather than leaving the fold to guess from titles. It mirrors
//! Claude Code's key layout under its own namespace, `_meta.macro`:
//!
//! - `toolName` - the Macro tool's name (`ReadContent`, `SendEmail`).
//!
//! Its tools run in-process, not over MCP, so names are native and tool
//! output is the tool's own JSON with no MCP envelope around it.

use agent_client_protocol::schema::v1::Meta;

use super::{HarnessReader, namespace};
use crate::domain::model::ToolName;

/// The `_meta` namespace `agent_inmem` writes under.
pub const NAMESPACE: &str = "macro";

/// Reader for the in-process agent's conventions.
pub struct MacroInmem;

impl HarnessReader for MacroInmem {
    fn meta_namespace(&self) -> Option<&'static str> {
        Some(NAMESPACE)
    }

    fn meta_tool_name(&self, meta: Option<&Meta>) -> Option<ToolName> {
        namespace(meta, NAMESPACE)?
            .get("toolName")?
            .as_str()
            .map(ToolName::native)
    }

    /// Every native tool this agent calls is a Macro tool; the ones it
    /// reaches over MCP belong to whichever server it named.
    fn macro_tool<'name>(&self, name: &'name ToolName) -> Option<&'name str> {
        match name {
            ToolName::Native { name } => Some(name),
            ToolName::Mcp { .. } => name.macro_mcp_tool(),
        }
    }

    /// Tool output arrives bare. A failed call reports
    /// `{ "error": <description> }` and nothing else.
    fn unwrap_tool_output(&self, raw: &serde_json::Value) -> (serde_json::Value, Option<String>) {
        if let Some(map) = raw.as_object()
            && map.len() == 1
            && let Some(error) = map.get("error").and_then(serde_json::Value::as_str)
        {
            return (serde_json::Value::Null, Some(error.to_owned()));
        }
        (raw.clone(), None)
    }
}
