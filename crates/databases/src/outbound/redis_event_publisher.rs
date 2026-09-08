//! Table-changed fan-out toward connection_gateway.
//!
//! Publishes `{table_id, version}` so live query chips, embeds, and views
//! re-run. Results are never pushed — every viewer re-executes as themselves.

use crate::domain::models::{TableId, TableVersion};
use crate::domain::ports::TableEventPublisher;

/// Errors from event publishing.
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    /// The transport rejected the publish.
    #[error("publish failed: {0:?}")]
    Transport(rootcause::Report),
}

/// [`TableEventPublisher`] over the gateway's Redis pub/sub.
///
/// TODO: hold the Redis connection/manager the composition root provides,
/// matching how other gateway-bound events are published today.
#[derive(Debug, Clone, Default)]
pub struct RedisTableEventPublisher {}

impl TableEventPublisher for RedisTableEventPublisher {
    type Err = PublishError;

    async fn table_changed(
        &self,
        _table_id: TableId,
        _version: TableVersion,
    ) -> Result<(), Self::Err> {
        todo!("publish {{table_id, version}} on the gateway channel")
    }
}
