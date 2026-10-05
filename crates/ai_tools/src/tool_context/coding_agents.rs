//! Compose coding-agent tools with the harness service's session capability.

use std::sync::Arc;

use agent_session::outbound::coding_agents_client::CodingAgentsClient;
use macro_service_urls::AgentHarnessServiceUrl;

/// Coding-agent discovery and dispatch context shared by the in-app AI hosts.
pub type ToolCodingAgentToolContext = agent_session::inbound::toolset::CodingAgentToolContext;

/// Use the same harness service and internal credential as other session clients.
pub fn build_coding_agent_tool_context(
    url: AgentHarnessServiceUrl,
    internal_api_key: String,
) -> anyhow::Result<ToolCodingAgentToolContext> {
    let client = CodingAgentsClient::new(url.as_ref(), &internal_api_key)
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    Ok(ToolCodingAgentToolContext {
        service: Arc::new(client),
    })
}
