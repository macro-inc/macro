//! Macro's own in-process agent, `agent_inmem`.
//!
//! The one harness this repository writes as well as reads, so it labels its
//! frames rather than leaving the fold to guess from titles. It mirrors
//! Claude Code's key layout under its own namespace, `_meta.macro`:
//!
//! - `toolName` - the Macro tool's name (`ReadContent`, `SendEmail`), or
//!   `mcp__<server>__<tool>` for a connected app's tool it reached over MCP.
//! - `subagent: true` - on its `Subagent` delegation.
//!
//! Its own tools run in-process, not over MCP, so their output is the tool's
//! own JSON with no envelope around it.

use agent_client_protocol::schema::v1::Meta;
use lazy_regex::regex_is_match;
use serde::Deserialize;

use super::{HarnessReader, ToolFrame, generic, has_namespace, macro_tools, namespaced, raw};
use crate::domain::model::ToolName;

/// The `_meta` namespace `agent_inmem` writes under.
pub const NAMESPACE: &str = "macro";

/// Reader for the in-process agent's conventions.
pub struct MacroInmem;

/// `_meta.macro`, as far as the fold reads it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MacroMeta {
    tool_name: Option<String>,
    #[serde(default)]
    subagent: bool,
}

fn meta_of(meta: Option<&Meta>) -> MacroMeta {
    namespaced(meta, NAMESPACE).unwrap_or_default()
}

/// How a failed in-process tool reports: `{ "error": <description> }` and
/// nothing else.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ErrorOutput {
    error: String,
}

impl HarnessReader for MacroInmem {
    fn announces(&self, name: &str) -> bool {
        regex_is_match!(r"(?i)^macro", name)
    }

    fn wrote(&self, frame: &ToolFrame<'_>) -> bool {
        has_namespace(frame.meta, NAMESPACE)
    }

    fn reported_tool_name(&self, frame: &ToolFrame<'_>) -> Option<ToolName> {
        meta_of(frame.meta)
            .tool_name
            .map(|name| name.parse().unwrap_or_else(|never| match never {}))
    }

    /// Every native tool this agent calls is a Macro tool; the ones it
    /// reaches over MCP belong to whichever server it named.
    fn macro_tool<'name>(&self, name: &'name ToolName) -> Option<&'name str> {
        match name {
            ToolName::Native { name } => Some(name),
            ToolName::Mcp { .. } => macro_tools::mcp_tool(name),
        }
    }

    /// Tool output arrives bare.
    fn unwrap_tool_output(
        &self,
        raw_output: &serde_json::Value,
    ) -> (serde_json::Value, Option<String>) {
        match raw::<ErrorOutput>(Some(raw_output)) {
            Some(ErrorOutput { error }) => (serde_json::Value::Null, Some(error)),
            None => (raw_output.clone(), None),
        }
    }

    fn is_subagent(&self, name: &ToolName, frame: &ToolFrame<'_>) -> bool {
        meta_of(frame.meta).subagent || generic::is_subagent(name, frame)
    }
}
