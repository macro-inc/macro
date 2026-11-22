//! The three services other crates use. They are the only way in: no other
//! crate can read a source's store, the overlay table or the flag, or build a
//! handle by hand.

use crate::UserMcpTools;
use crate::domain::models::{
    AddedBy, ApiHandle, ApiRequest, ApiResponse, ConnectStep, Connector, ConnectorId, ConnectorKey,
    McpConnections, McpHandle, Permitted, Result, ServerUrl, Upstream,
};
use macro_user_id::user_id::MacroUserIdStr;

/// MCP access to a user's connections.
pub trait McpConnectionsService: Send + Sync + 'static {
    /// Everything this user has, already decided by the rules.
    fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<McpConnections>> + Send;

    /// Tools for in-process agents. A connection that fails to dial is left
    /// out, not an error.
    fn toolset(&self, connections: &[McpHandle]) -> impl Future<Output = UserMcpTools> + Send;

    /// The upstream call for the sandbox proxy. Takes proof the session may
    /// reach it.
    fn upstream(&self, permitted: Permitted<'_>) -> impl Future<Output = Result<Upstream>> + Send;
}

/// API access to connected apps.
pub trait ApiConnectionsService: Send + Sync + 'static {
    /// This user's API access to one app, if their connection provides it.
    fn connection(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> impl Future<Output = Result<Option<ApiHandle>>> + Send;

    /// Every user with API access to an app. Granola's background sync uses
    /// this.
    fn holders(&self, app: &ConnectorId) -> impl Future<Output = Result<Vec<ApiHandle>>> + Send;

    /// Call the app's API through a connection.
    fn call(
        &self,
        connection: &ApiHandle,
        request: ApiRequest,
    ) -> impl Future<Output = Result<ApiResponse>> + Send;
}

/// Listing, connecting and changing a user's connections.
pub trait ConnectionManagementService: Send + Sync + 'static {
    /// What the web shows: each app or URL server with its status.
    fn list(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Connector>>> + Send;

    /// Whether an app exists in the catalog at all. Agent app pins use this.
    fn connectable(&self, app: &ConnectorId) -> impl Future<Output = Result<bool>> + Send;

    /// Begin connecting an app, or signing in to a server added by URL.
    fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> impl Future<Output = Result<ConnectStep>> + Send;

    /// Record the connection the user just finished making to an app.
    fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> impl Future<Output = Result<Connector>> + Send;

    /// Add a server by URL, enabled and not yet signed in to. A URL the user
    /// already has is returned as it stands.
    fn add_server(
        &self,
        user: &MacroUserIdStr<'static>,
        url: ServerUrl,
        name: &str,
        added_by: AddedBy,
    ) -> impl Future<Output = Result<Connector>> + Send;

    /// Turn a connection on or off.
    fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Rename a connection.
    fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Remove a connection. Removing GitHub unlinks the account.
    fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> impl Future<Output = Result<()>> + Send;
}
