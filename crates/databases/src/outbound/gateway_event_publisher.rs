//! Table-changed and awareness fan-out through the connection gateway; each
//! client re-runs its own queries as itself, so results are never pushed.

use chrono::{DateTime, Utc};
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde::Serialize;

use crate::domain::models::{Awareness, DatabaseId, TableId, TableVersion};
use crate::domain::ports::TableEventPublisher;

#[cfg(test)]
mod test;

/// Message type delivered to gateway subscribers of the database entity.
pub const TABLE_CHANGED_MESSAGE_TYPE: &str = "database_table_changed";
/// Message type carrying one viewer's [`Awareness`] to the others.
pub const AWARENESS_MESSAGE_TYPE: &str = "database_awareness";

/// The [`TABLE_CHANGED_MESSAGE_TYPE`] payload: one table's new version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TableChanged {
    /// The database the table belongs to.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table that changed.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// The table's version after the write.
    pub version: TableVersion,
}

/// The [`AWARENESS_MESSAGE_TYPE`] payload: one viewer's awareness, stamped
/// when the server relayed it so receivers can drop older relays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AwarenessRelay {
    /// The database the viewer is in.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The viewer.
    pub user_id: String,
    /// Where the viewer is.
    pub state: Awareness,
    /// When the server relayed it, in milliseconds since the Unix epoch.
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub relayed_at: DateTime<Utc>,
}

/// Errors from event publishing.
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    /// The gateway rejected or failed the publish.
    #[error("gateway publish failed")]
    Gateway(#[source] anyhow::Error),
    /// The payload did not serialize.
    #[error("payload serialization failed")]
    Serialize(#[source] serde_json::Error),
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
    type Error = PublishError;

    #[tracing::instrument(skip(self), err)]
    async fn table_changed(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<(), Self::Error> {
        self.client
            .send_message(
                EntityType::Database.with_entity_string(database_id.to_string()),
                TABLE_CHANGED_MESSAGE_TYPE.to_string(),
                serde_json::to_value(TableChanged {
                    database_id,
                    table_id,
                    version,
                })
                .map_err(PublishError::Serialize)?,
            )
            .await
            .map_err(PublishError::Gateway)?;
        Ok(())
    }

    #[tracing::instrument(skip(self, state), err)]
    async fn awareness(
        &self,
        database_id: DatabaseId,
        user_id: &MacroUserIdStr<'_>,
        state: &Awareness,
    ) -> Result<(), Self::Error> {
        self.client
            .send_message(
                EntityType::Database.with_entity_string(database_id.to_string()),
                AWARENESS_MESSAGE_TYPE.to_string(),
                serde_json::to_value(AwarenessRelay {
                    database_id,
                    user_id: user_id.as_ref().to_string(),
                    state: state.clone(),
                    relayed_at: Utc::now(),
                })
                .map_err(PublishError::Serialize)?,
            )
            .await
            .map_err(PublishError::Gateway)?;
        Ok(())
    }
}

/// A publisher for hosts with no gateway (AI tool processes, tests): the
/// write still commits, clients simply refresh on their own.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoOpTableEventPublisher;

impl TableEventPublisher for NoOpTableEventPublisher {
    type Error = std::convert::Infallible;

    async fn table_changed(
        &self,
        _database_id: DatabaseId,
        _table_id: TableId,
        _version: TableVersion,
    ) -> Result<(), Self::Error> {
        Ok(())
    }

    async fn awareness(
        &self,
        _database_id: DatabaseId,
        _user_id: &MacroUserIdStr<'_>,
        _state: &Awareness,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
}

/// The publisher for hosts that may or may not have gateway credentials;
/// without them the committed write's liveness ping is dropped.
#[derive(Debug, Clone)]
pub enum MaybeGatewayTableEventPublisher {
    /// Publish through the connection gateway.
    Gateway(GatewayTableEventPublisher),
    /// Drop liveness events in hosts that do not configure the gateway.
    NoOp(NoOpTableEventPublisher),
}

impl From<GatewayTableEventPublisher> for MaybeGatewayTableEventPublisher {
    fn from(publisher: GatewayTableEventPublisher) -> Self {
        Self::Gateway(publisher)
    }
}

impl TableEventPublisher for MaybeGatewayTableEventPublisher {
    type Error = PublishError;

    async fn table_changed(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> Result<(), Self::Error> {
        match self {
            Self::Gateway(publisher) => {
                publisher
                    .table_changed(database_id, table_id, version)
                    .await
            }
            Self::NoOp(publisher) => publisher
                .table_changed(database_id, table_id, version)
                .await
                .map_err(|never| match never {}),
        }
    }

    async fn awareness(
        &self,
        database_id: DatabaseId,
        user_id: &MacroUserIdStr<'_>,
        state: &Awareness,
    ) -> Result<(), Self::Error> {
        match self {
            Self::Gateway(publisher) => publisher.awareness(database_id, user_id, state).await,
            Self::NoOp(publisher) => publisher
                .awareness(database_id, user_id, state)
                .await
                .map_err(|never| match never {}),
        }
    }
}
