//! The code-mode tools a turn shows its model, as the turn's code-mode kind
//! defines them. A session lists its MCP tools once, when it connects, so a
//! turn whose kind differs from that list's (the owner's flag changed since)
//! would otherwise read the other kind's `ExecuteCode`; the internal MCP runs
//! every call as the turn's kind either way.

use agent_code_mode::domain::CodeModeKind;
use ai_toolset::{RequestContext, SearchableTool, ToolCallFuture, ToolInfo, ToolSet};
use mcp_toolset::RemoteMcpToolSet;

use crate::domain::mcp::{CODE_MODE_MCP_TOOLS, MACRO_INTERNAL_MCP_NAME};

/// The session's MCP tools, with the internal server's code-mode tools
/// described as `kind`'s.
pub(super) struct TurnCodeTools {
    tools: RemoteMcpToolSet,
    /// `kind`'s code-mode tools, by their mangled names.
    code_tools: Vec<SearchableTool>,
}

impl TurnCodeTools {
    pub(super) fn new(tools: RemoteMcpToolSet, kind: CodeModeKind) -> Self {
        let code_tools = agent_code_mode::inbound::toolset::session_toolset(kind)
            .tools
            .iter()
            .map(|(name, tool)| SearchableTool {
                name: format!("mcp__{MACRO_INTERNAL_MCP_NAME}__{name}"),
                description: tool.description.clone(),
                schema: schemars::Schema::from(tool.input_schema.clone()),
            })
            .collect();
        Self { tools, code_tools }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for TurnCodeTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        self.tools
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        ToolSet::<Context>::request_schemas(&self.tools)
    }

    /// The session's tools, the internal server's code tools replaced by
    /// the turn's kind's.
    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<Context>::searchable_catalog(&self.tools)
            .into_iter()
            .map(|tool| {
                let ours = CODE_MODE_MCP_TOOLS.contains(&tool.name.as_str())
                    && self.tools.server_of(&tool.name) == Some(MACRO_INTERNAL_MCP_NAME);
                match self.code_tools.iter().find(|code| code.name == tool.name) {
                    Some(code) if ours => code.clone(),
                    _ => tool,
                }
            })
            .collect()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        ToolSet::<Context>::searchable_toolset_names(&self.tools)
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.tools, tool_name)
    }
}

#[cfg(test)]
#[path = "turn_code_tools/test.rs"]
mod test;
