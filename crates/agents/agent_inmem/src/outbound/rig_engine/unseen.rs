//! What a turn of a session nobody watches ([`ReplyDelivery::Unseen`], a
//! routine draft) is given: a short prompt for working out of sight, and code
//! mode's three tools with nothing to present, in place of a conversation's
//! guidance, review cards, user tools and tool catalog.
//!
//! [`ReplyDelivery::Unseen`]: crate::domain::engine::ReplyDelivery::Unseen

use ai_toolset::{RequestContext, SearchableTool, ToolCallFuture, ToolInfo, ToolSet, ToolSetError};
use mcp_toolset::RemoteMcpToolSet;

use crate::domain::mcp::CODE_MODE_MCP_TOOLS;

/// The shared system block: who the agent is, out of sight, and how code mode
/// works, with no conversation to write for.
pub(super) const PROMPT: &str = include_str!("unseen.md");

const EXECUTE_CODE: &str = "mcp__macro_internal__ExecuteCode";

/// Code mode's tools out of a session's MCP servers, and nothing else.
/// `ExecuteCode` goes out without its reviews, views and the PresentView
/// schema: nobody would see what they present.
pub(super) struct CodeModeOnly {
    tools: RemoteMcpToolSet,
    execute_code: String,
}

impl CodeModeOnly {
    pub(super) fn new(tools: RemoteMcpToolSet) -> Self {
        Self {
            tools,
            execute_code: agent_code_mode::inbound::toolset::unseen_execute_code_description(),
        }
    }
}

impl<Context: Send + Sync + 'static> ToolSet<Context> for CodeModeOnly {
    fn dispatch_tool_call<'a>(
        &'a self,
        context: Context,
        request_context: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ToolCallFuture<'a> {
        if !CODE_MODE_MCP_TOOLS.contains(&tool_name) {
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

    /// The code tools, advertised by the caller as eager tools.
    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        ToolSet::<Context>::searchable_catalog(&self.tools)
            .into_iter()
            .filter(|tool| CODE_MODE_MCP_TOOLS.contains(&tool.name.as_str()))
            .map(|tool| SearchableTool {
                description: if tool.name == EXECUTE_CODE {
                    self.execute_code.clone()
                } else {
                    tool.description
                },
                ..tool
            })
            .collect()
    }

    fn routing_description<'a>(&'a self, tool_name: &'a str) -> Option<ToolInfo> {
        ToolSet::<Context>::routing_description(&self.tools, tool_name)
    }
}
