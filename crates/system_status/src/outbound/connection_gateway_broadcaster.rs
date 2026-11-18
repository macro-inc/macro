//! Pushes the current status to every open app through the connection
//! gateway.

use std::sync::Arc;

use connection_gateway_client::ConnectionGatewayClient;

use crate::domain::{models::CurrentSystemStatus, ports::StatusBroadcaster};

/// The websocket message type clients listen for. Its data is a
/// [`CurrentSystemStatus`].
pub const SYSTEM_STATUS_MESSAGE_TYPE: &str = "system_status";

/// Broadcasts status changes over the connection gateway.
#[derive(Clone, Debug)]
pub struct ConnectionGatewayStatusBroadcaster {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayStatusBroadcaster {
    /// Create a broadcaster over the given gateway client.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

/// Errors produced while broadcasting a status.
#[derive(Debug, thiserror::Error)]
pub enum ConnectionGatewayStatusBroadcasterErr {
    /// The status could not be serialized.
    #[error(transparent)]
    Serialize(#[from] serde_json::Error),
    /// The gateway did not accept the broadcast.
    #[error("connection gateway broadcast failed: {0}")]
    Gateway(String),
}

impl StatusBroadcaster for ConnectionGatewayStatusBroadcaster {
    type Err = ConnectionGatewayStatusBroadcasterErr;

    #[tracing::instrument(err, skip_all)]
    async fn broadcast(&self, status: &CurrentSystemStatus) -> Result<(), Self::Err> {
        self.client
            .broadcast_message(
                SYSTEM_STATUS_MESSAGE_TYPE.to_owned(),
                serde_json::to_value(status)?,
            )
            .await
            .map_err(|error| ConnectionGatewayStatusBroadcasterErr::Gateway(format!("{error:#}")))
    }
}
