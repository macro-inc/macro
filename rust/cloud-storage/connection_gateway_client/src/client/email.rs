use super::ConnectionGatewayClient;
use connection_gateway_models::MessageReceipt;
use model_entity::EntityType;
use serde_json::json;

impl ConnectionGatewayClient {
    /// Trigger refresh of the user's emails
    #[tracing::instrument(skip(self))]
    pub async fn refresh_email(
        &self,
        user_id: &str,
        event_type: &str,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        self.send_message(
            EntityType::User.with_entity_str(user_id),
            "refresh_email".to_string(),
            json!(event_type),
        )
        .await
    }
}
