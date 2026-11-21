//! The MCP tools a turn advertises: an allowlist over a session's servers.
//! A watched turn keeps Macro's own (code mode and saved reviews), an unseen
//! one only code mode's; neither gets a connected app's, which a program
//! reaches through `macro.connectedApps` under the egress proxy.

use ai_toolset::{RequestContext, SearchableTool, ToolCallFuture, ToolInfo, ToolSet, ToolSetError};
use mcp_toolset::RemoteMcpToolSet;

/// What a model told of an unknown tool does instead: there is no
/// `SearchTools` here, connected apps are reached from code.
pub(super) const CONNECTED_APPS_FROM_CODE_HINT: &str = "A connected app's tools are not called \
     directly here: find them from ExecuteCode with \
     macro.connectedApps.searchTools(execution, keywords), or list apps with \
     macro.connectedApps.list(execution) and read app.tools(), then tool.call(args). Otherwise continue without it.";

const EXECUTE_CODE: &str = "mcp__macro_internal__ExecuteCode";

/// Only the `keep` tools of Macro's own MCP server, advertised by the caller
/// as eager tools; a call to any other is refused as not found.
pub(super) struct McpAllowlist {
    tools: RemoteMcpToolSet,
    keep: &'static [&'static str],
    /// Replaces `ExecuteCode`'s description, when set.
    execute_code: Option<String>,
}

impl McpAllowlist {
    pub(super) fn new(tools: RemoteMcpToolSet, keep: &'static [&'static str]) -> Self {
        Self {
            tools,
            keep,
            execute_code: None,
        }
    }

    /// Describes `ExecuteCode` as `description` instead of as its server does.
    pub(super) fn with_execute_code_description(mut self, description: String) -> Self {
        self.execute_code = Some(description);
        self
    }

    /// Whether `tool_name` is kept: listed, and registered by Macro's own
    /// server, never by one whose name mangles to the same prefix.
    fn kept(&self, tool_name: &str) -> bool {
        self.keep.contains(&tool_name)
            && self.tools.server_of(tool_name) == Some(crate::domain::mcp::MACRO_INTERNAL_MCP_NAME)
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for McpAllowlist {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        if !self.kept(tool_name) {
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

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<Context>::searchable_catalog(&self.tools)
            .into_iter()
            .filter(|tool| self.kept(&tool.name))
            .map(|tool| match &self.execute_code {
                Some(description) if tool.name == EXECUTE_CODE => SearchableTool {
                    description: description.clone(),
                    ..tool
                },
                _ => tool,
            })
            .collect()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.tools, tool_name)
    }
}
