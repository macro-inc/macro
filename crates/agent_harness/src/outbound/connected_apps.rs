//! Whether a user has an app connected, as the connectors service decides
//! it: the same answer chat tool loading and the sandbox get.

use std::sync::Arc;

use connectors::{ConnectorId, ConnectorKey, ConnectorsError, McpConnectionsService, Status};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::app_connections::ConnectedApps;

#[cfg(test)]
mod test;

/// The user's connections could not be read.
#[derive(Debug, thiserror::Error)]
#[error("could not read the app connection: {0}")]
pub struct ConnectionLookupError(#[from] ConnectorsError);

/// [`ConnectedApps`] over the connectors service.
pub struct ConnectorsConnectedApps<Connections> {
    connections: Arc<Connections>,
}

impl<Connections> ConnectorsConnectedApps<Connections> {
    /// Answer from `connections`.
    pub fn new(connections: Arc<Connections>) -> Self {
        Self { connections }
    }
}

impl<Connections> ConnectedApps for ConnectorsConnectedApps<Connections>
where
    Connections: McpConnectionsService,
{
    type Err = ConnectionLookupError;

    #[tracing::instrument(skip(self, user), err)]
    async fn connected_app_name(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<String>, ConnectionLookupError> {
        // A string that is not an app slug names no app anyone connected.
        let Ok(app) = ConnectorId::parse(app_slug) else {
            return Ok(None);
        };
        let key = ConnectorKey::App(app);
        let connections = self.connections.connections(user).await?;
        if connections.status(&key) != Status::Connected {
            return Ok(None);
        }

        let name = connections
            .handles()
            .find(|handle| *handle.key() == key)
            .map(|handle| handle.name().to_owned());

        Ok(name)
    }
}
