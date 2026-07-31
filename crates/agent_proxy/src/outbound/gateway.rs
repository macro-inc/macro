//! Connection gateway adapter implementing the [`ClientNotifier`] port.

use crate::domain::ports::ClientNotifier;
use connection_gateway_client::client::ConnectionGatewayClient;
use macro_uuid::Uuid;
use model_entity::EntityType;

/// Pushes agent session events to the connection gateway, addressed to the
/// chat entity backing the session so every connected client tracking the
/// chat receives them.
pub struct GatewayNotifier {
    client: ConnectionGatewayClient,
}

impl GatewayNotifier {
    /// Create a notifier from a configured gateway client.
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl ClientNotifier for GatewayNotifier {
    #[tracing::instrument(err, skip(self, payload))]
    async fn notify_session(
        &self,
        session_id: Uuid,
        message_type: &'static str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.client
            .send_message(
                EntityType::Chat.with_entity_string(session_id.to_string()),
                message_type.to_string(),
                payload,
            )
            .await?;
        Ok(())
    }
}
