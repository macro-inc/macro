#![deny(missing_docs)]
//! Macro's integrations: the apps and MCP servers a user connects, and how
//! agents, the sandbox proxy, imports and the web reach them.
//!
//! The three service traits ([`McpConnectionsService`],
//! [`ApiConnectionsService`], [`ConnectionManagementService`]) are the only
//! way in, and [`Connectors`], built once per process by [`composition`], is
//! their one implementation. Which source holds a connection (native servers,
//! the GitHub account link, Pipedream, Macro Connect) stays inside the crate:
//! no public type names one.

pub mod composition;
mod domain;
#[cfg(any(test, feature = "test-fakes"))]
pub mod fake;
/// The `/connectors` HTTP API, the vendor callback routes, and the agent
/// connector tools.
pub mod inbound;
mod outbound;

pub use domain::models::{
    AddedBy, ApiHandle, ApiRequest, ApiResponse, ConnectStep, Connector, ConnectorId, ConnectorKey,
    ConnectorsError, InvalidConnectorId, InvalidServerUrl, McpConnections, McpHandle,
    PermitRefused, Permitted, Result, Selection, ServerUrl, Status, Upstream, UserMcpTools,
};
/// The crate's exported service: the three traits and [`Connectors`], their
/// one implementation. Also re-exported at the crate root.
pub use domain::service;
pub use domain::service::{
    ApiConnectionsService, ConnectionManagementService, Connectors, McpConnectionsService,
};
/// Address-guarded HTTP for traffic to user-chosen servers: the egress
/// proxy's forwarders refuse the same addresses the connectors do.
pub use outbound::guarded_http;
