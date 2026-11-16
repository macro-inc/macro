//! A watched turn's MCP tools: Macro's own internal ones (code mode and saved
//! reviews), never a connected app's. A program reaches connected apps through
//! `macro.connectedApps`, under the egress proxy's credential stamping.

use ai_toolset::{RequestContext, SearchableTool, ToolCallFuture, ToolInfo, ToolSet, ToolSetError};
use mcp_toolset::RemoteMcpToolSet;

/// What a model told of an unknown tool does instead: there is no
/// `SearchTools` here, connected apps are reached from code.
pub(super) const UNKNOWN_TOOL_HINT: &str = "A connected app's tools are not called directly here: \
     find them from ExecuteCode with macro.connectedApps.searchTools(execution, keywords) or \
     macro.connectedApps.list(execution), then tool.call(args). Otherwise continue without it.";

/// Only `keep` out of a session's MCP servers.
pub(super) struct MacroToolsOnly {
    tools: RemoteMcpToolSet,
    keep: &'static [&'static str],
}

impl MacroToolsOnly {
    pub(super) fn new(tools: RemoteMcpToolSet, keep: &'static [&'static str]) -> Self {
        Self { tools, keep }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for MacroToolsOnly {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        if !self.keep.contains(&tool_name) {
            return Box::pin(std::future::ready(Err(ToolSetError::NotFound(
                tool_name.to_owned(),
            ))));
        }
        self.tools
            .dispatch_tool_call(context, request_context, tool_name, json)
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        None
    }

    /// The kept tools, advertised by the caller as eager tools.
    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<Context>::searchable_catalog(&self.tools)
            .into_iter()
            .filter(|tool| self.keep.contains(&tool.name.as_str()))
            .collect()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.tools, tool_name)
    }
}
