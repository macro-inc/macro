//! The apps a user has connected: their Pipedream connections, or the native
//! MCP connection for an app that is overlaid onto its own server.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::{ConnectionStore, ConnectorOverlays, OverlayConnections};

use crate::domain::app_connections::ConnectedApps;

#[cfg(test)]
mod test;

/// The connection store could not be read.
#[derive(Debug, thiserror::Error)]
#[error("could not read the app connection: {0}")]
pub struct ConnectionLookupError(String);

/// [`ConnectedApps`] over the Pipedream connection store, answering overlaid
/// apps from the native MCP stack.
pub struct PipedreamConnectedApps<Connections, Overlays> {
    connections: Arc<Connections>,
    overlay_connections: Arc<Overlays>,
}

impl<Connections, Overlays> PipedreamConnectedApps<Connections, Overlays> {
    /// Read Pipedream connections and overlays from `connections`, and
    /// overlaid apps' connections from `overlay_connections`.
    pub fn new(connections: Arc<Connections>, overlay_connections: Arc<Overlays>) -> Self {
        Self {
            connections,
            overlay_connections,
        }
    }
}

impl<Connections, Overlays> ConnectedApps for PipedreamConnectedApps<Connections, Overlays>
where
    Connections: ConnectionStore + ConnectorOverlays,
    Overlays: OverlayConnections,
{
    type Err = ConnectionLookupError;

    async fn connected_app_name(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<String>, ConnectionLookupError> {
        let lookup = |error: &dyn std::fmt::Debug| ConnectionLookupError(format!("{error:?}"));
        if let Some(overlay) = self
            .connections
            .overlay(app_slug)
            .await
            .map_err(|error| lookup(&error))?
        {
            return self
                .overlay_connections
                .connected_name(user, &overlay)
                .await
                .map_err(|error| lookup(&error));
        }
        let connection = self
            .connections
            .load(user, app_slug)
            .await
            .map_err(|error| lookup(&error))?;
        Ok(connection
            .filter(|connection| connection.enabled)
            .map(|connection| connection.server_name))
    }
}
