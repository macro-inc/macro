//! What a turn of a session nobody watches ([`ReplyDelivery::Unseen`], a
//! routine draft) is given: a short prompt for working out of sight, and code
//! mode's three tools with nothing to present, in place of a conversation's
//! guidance, review cards, user tools and tool catalog.
//!
//! [`ReplyDelivery::Unseen`]: crate::domain::engine::ReplyDelivery::Unseen

use mcp_toolset::RemoteMcpToolSet;

use super::mcp_allowlist::McpAllowlist;
use crate::domain::mcp::CODE_MODE_MCP_TOOLS;

/// The shared system block: who the agent is, out of sight, and how code mode
/// works, with no conversation to write for.
pub(super) const PROMPT: &str = include_str!("unseen.md");

/// Code mode's tools out of a session's MCP servers, and nothing else.
/// `ExecuteCode` goes out without its reviews, views and the PresentView
/// schema: nobody would see what they present.
pub(super) fn code_mode_only(tools: RemoteMcpToolSet) -> McpAllowlist {
    McpAllowlist::new(tools, CODE_MODE_MCP_TOOLS).with_execute_code_description(
        agent_code_mode::inbound::toolset::unseen_execute_code_description(),
    )
}
