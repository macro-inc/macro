//! Connection-gateway adapter that pushes projection updates to clients.

use std::sync::Arc;

use connection_gateway_client::ConnectionGatewayClient;
use model_entity::EntityType;

use crate::domain::{
    model::{TargetType, UserAiProjection},
    projection_notifier::ProjectionNotifier,
};

/// The websocket `message_type` for projection state updates. The payload
/// mirrors the upsert endpoint's `ProjectionStateResponse` (plus `type` and
/// `target_type`) so the frontend can write it straight into its query cache.
pub const AI_PROJECTION_UPDATED_MESSAGE_TYPE: &str = "ai_projection_updated";

/// [`ProjectionNotifier`] that pushes updates through the connection gateway.
#[derive(Clone)]
pub struct GatewayProjectionNotifier {
    client: Arc<ConnectionGatewayClient>,
}

impl GatewayProjectionNotifier {
    /// Creates a notifier over an existing connection gateway client.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl ProjectionNotifier for GatewayProjectionNotifier {
    #[tracing::instrument(
        skip(self, instance),
        fields(
            ai_projection_id = %instance.ai_projection_id,
            target_id = %instance.target_id,
        ),
        err
    )]
    async fn notify_updated(
        &self,
        target_type: TargetType,
        instance: &UserAiProjection,
    ) -> anyhow::Result<()> {
        let entity = match target_type {
            TargetType::User => EntityType::User.with_entity_str(&instance.target_id),
            TargetType::Team => EntityType::Team.with_entity_str(&instance.target_id),
        };

        let payload = serde_json::json!({
            "type": AI_PROJECTION_UPDATED_MESSAGE_TYPE,
            "id": instance.ai_projection_id,
            "target_type": target_type,
            "status": instance.status,
            "data": instance.result,
            "error": instance.error,
            "generated_at": instance.generated_at,
            "stale_at": instance.stale_at,
        });

        self.client
            .send_message(
                entity,
                AI_PROJECTION_UPDATED_MESSAGE_TYPE.to_string(),
                payload,
            )
            .await?;

        Ok(())
    }
}
