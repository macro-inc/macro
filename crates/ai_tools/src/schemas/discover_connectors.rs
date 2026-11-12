//! The removed `DiscoverConnectors` tool, kept so saved agent sessions that
//! called it still render. `macro.connectedApps.discover` does the same in
//! code mode.
use ai_toolset::schema::PhantomTool;
use pipedream_mcp::domain::service::discovery::DiscoveryRequest;
use pipedream_mcp::inbound::toolset::DiscoverConnectorsResponse;
use schemars::JsonSchema;
use serde::Serialize;

/// Tool: search for an app to connect, or inspect one's tools and status.
#[derive(Debug, Serialize, JsonSchema)]
#[schemars(
    title = "DiscoverConnectors",
    description = "Find an integration when an external app is missing or a workflow requires an unconnected account. Search by app name, then inspect a returned app_slug to see its actual tools and connection status."
)]
pub struct DiscoverConnectors {
    /// Search for an app, or inspect a catalog result's actual capabilities.
    pub request: DiscoveryRequest,
}

pub fn discover_connectors() -> PhantomTool<DiscoverConnectors, DiscoverConnectorsResponse> {
    PhantomTool::new("DiscoverConnectors")
}
