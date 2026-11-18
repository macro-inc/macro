/// Browsing the catalog of connectable apps.
pub mod catalog;
/// Completion and revocation of Pipedream connections.
pub mod connect;
/// Discover suitable connectors before asking a user to authorize them.
pub mod discovery;
/// The Pipedream MCP tool set.
pub mod toolset;

pub use catalog::browse_catalog;
pub use connect::{
    PipedreamConnectError, complete_connect_connection, complete_pipedream_connection,
    connect_app_for, disconnect_mcp_server, start_connect_session,
};
pub use toolset::PipedreamToolSet;
