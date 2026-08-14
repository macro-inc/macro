//! [`EdgeSink`] over the gateway's per-instance Redis outbound channel.

use crate::domain::models::ConnectionId;
use crate::domain::ports::EdgeSink;
use anyhow::Context;
use connection_gateway_models::fanout::{ToGateway, outbound_channel};
use redis::AsyncCommands;

/// Publishes `FromRouter` envelope bytes to the gateway instance that holds
/// the target connection's socket.
pub struct RedisSink {
    connection: redis::aio::MultiplexedConnection,
}

impl RedisSink {
    /// Wrap an established Redis connection.
    pub fn new(connection: redis::aio::MultiplexedConnection) -> Self {
        Self { connection }
    }
}

impl EdgeSink for RedisSink {
    type Err = anyhow::Error;

    async fn deliver(&self, conn: &ConnectionId, frame: Vec<u8>) -> Result<(), Self::Err> {
        let message = ToGateway::Frame {
            conn: conn.conn.clone(),
            text: false,
            payload: frame,
        };
        let payload = postcard::to_stdvec(&message).context("failed to encode ToGateway frame")?;
        let mut connection = self.connection.clone();
        connection
            .publish::<String, &[u8], ()>(outbound_channel(&conn.gateway), &payload)
            .await
            .context("failed to publish frame to gateway outbound channel")?;
        Ok(())
    }
}
