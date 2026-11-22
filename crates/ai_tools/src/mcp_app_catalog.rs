//! The connector catalog consulted when an agent pins apps.

use bots::domain::ports::{BotError, McpAppCatalog};
use connectors::domain::models::ConnectorId;
use connectors::domain::service::ConnectionManagementService;

/// Confirms the apps an agent pins against the connectors catalog.
///
/// Without connectors on this host every slug is refused: an unverified app
/// is not stored.
#[derive(Clone)]
pub struct ConnectorsAppCatalog<S> {
    connectors: Option<S>,
}

impl<S> ConnectorsAppCatalog<S> {
    /// Ask `connectors`; `None` where this host has none.
    pub fn new(connectors: Option<S>) -> Self {
        Self { connectors }
    }
}

impl<S> std::fmt::Debug for ConnectorsAppCatalog<S> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectorsAppCatalog")
            .field("configured", &self.connectors.is_some())
            .finish()
    }
}

impl<S: ConnectionManagementService> McpAppCatalog for ConnectorsAppCatalog<S> {
    async fn is_connectable_app(&self, slug: &str) -> Result<bool, BotError> {
        let Ok(app) = ConnectorId::parse(slug) else {
            return Ok(false);
        };
        let Some(connectors) = &self.connectors else {
            return Err(BotError::Unavailable(format!(
                "cannot verify MCP app {slug}: connectors are not configured"
            )));
        };
        connectors.connectable(&app).await.map_err(|error| {
            tracing::warn!(%slug, error = ?error, "MCP app lookup failed");
            BotError::Unavailable(format!("could not verify MCP app {slug}"))
        })
    }
}

#[cfg(test)]
mod test;
