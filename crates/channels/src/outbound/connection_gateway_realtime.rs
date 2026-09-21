//! Connection-gateway realtime adapter for channel side effects.

use crate::domain::{ports::ChannelRealtimePublisher, side_effects::ChannelRealtimeEffect};
use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as GatewayEntityType;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

/// Connection-gateway realtime publisher adapter.
#[derive(Clone)]
pub struct ConnectionGatewayChannelRealtimePublisher {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayChannelRealtimePublisher {
    /// Create a realtime publisher adapter.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }

    async fn send_update<T: Serialize + Send>(
        &self,
        message_type: &'static str,
        payload: T,
        participants: Vec<MacroUserIdStr<'static>>,
    ) -> anyhow::Result<()> {
        if participants.is_empty() {
            return Ok(());
        }
        self.client
            .batch_send_message(
                message_type.to_string(),
                serde_json::to_value(payload)?,
                participants
                    .iter()
                    .map(|p| GatewayEntityType::User.with_entity_str(p.as_ref()))
                    .collect(),
            )
            .await?;
        Ok(())
    }
}

impl ChannelRealtimePublisher for ConnectionGatewayChannelRealtimePublisher {
    type Err = anyhow::Error;

    async fn publish(&self, effect: ChannelRealtimeEffect) -> Result<(), Self::Err> {
        match effect {
            ChannelRealtimeEffect::PictureChanged {
                recipients,
                channel_id,
            } => {
                self.send_update(
                    "comms_channel_picture",
                    PictureChangedRealtimeData { channel_id },
                    recipients,
                )
                .await
            }
        }
    }
}

#[derive(Serialize)]
struct PictureChangedRealtimeData {
    channel_id: Uuid,
}
