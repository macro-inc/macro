//! The apps a user has connected, read from their Pipedream connections.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectionStore;

use crate::domain::app_connections::ConnectedApps;

/// The connection store could not be read.
#[derive(Debug, thiserror::Error)]
#[error("could not read the Pipedream connection: {0}")]
pub struct ConnectionLookupError(String);

/// [`ConnectedApps`] over the Pipedream connection store.
pub struct PipedreamConnectedApps<Connections> {
    connections: Arc<Connections>,
}

impl<Connections> PipedreamConnectedApps<Connections> {
    /// Read connections from `connections`.
    pub fn new(connections: Arc<Connections>) -> Self {
        Self { connections }
    }
}

impl<Connections: ConnectionStore> ConnectedApps for PipedreamConnectedApps<Connections> {
    type Err = ConnectionLookupError;

    async fn connected_app_name(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<String>, ConnectionLookupError> {
        let connection = self
            .connections
            .load(user, app_slug)
            .await
            .map_err(|error| ConnectionLookupError(format!("{error:?}")))?;
        Ok(connection
            .filter(|connection| connection.enabled)
            .map(|connection| connection.server_name))
    }
}
