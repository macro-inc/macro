//! Table-changed fan-out through the connection gateway.
//!
//! Every client with the database open tracks the `Database` entity on its
//! websocket; the gateway delivers a `database_table_changed` message to
//! those connections and each re-runs its own queries. Results are never
//! pushed — every viewer re-executes as themselves.

use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::EntityType;

use crate::domain::models::{DatabaseId, TableId, TableVersion};
use crate::domain::ports::TableEventPublisher;

/// Message type delivered to gateway subscribers of the database entity.
pub const TABLE_CHANGED_MESSAGE_TYPE: &str = "database_table_changed";

/// Errors from event publishing.
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    /// The gateway rejected or failed the publish.
    #[error("gateway publish failed: {0}")]
    Gateway(String),
}

/// [`TableEventPublisher`] over the connection gateway.
#[derive(Debug, Clone)]
pub struct GatewayTableEventPublisher {
    client: ConnectionGatewayClient,
}

impl GatewayTableEventPublisher {
    /// Create a publisher over the given gateway client.
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl TableEventPublisher for GatewayTableEventPublisher {
    type Err = PublishError;

    #[tracing::instrument(skip(self), err)]
    async fn table_changed(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<(), Self::Err> {
        self.client
            .send_message(
                EntityType::Database.with_entity_string(database_id.to_string()),
                TABLE_CHANGED_MESSAGE_TYPE.to_string(),
                serde_json::json!({
                    "databaseId": database_id,
                    "tableId": table_id,
                    "version": version.0,
                }),
            )
            .await
            .map_err(|e| PublishError::Gateway(format!("{e:#}")))?;
        Ok(())
    }
}

/// A publisher for hosts with no gateway (AI tool processes, tests): the
/// write still commits, clients simply refresh on their own.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpTableEventPublisher;

impl TableEventPublisher for NoOpTableEventPublisher {
    type Err = std::convert::Infallible;

    async fn table_changed(
        &self,
        _database_id: DatabaseId,
        _table_id: TableId,
        _version: TableVersion,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
