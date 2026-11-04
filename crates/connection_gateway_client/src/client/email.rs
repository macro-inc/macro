use super::ConnectionGatewayClient;
use connection_gateway_models::MessageReceipt;
use model_entity::EntityType;

const REFRESH_EMAIL: &str = "refresh_email";

impl ConnectionGatewayClient {
    /// Trigger refresh of the user's emails
    #[tracing::instrument(skip(self, event))]
    pub async fn refresh_email(
        &self,
        user_id: &str,
        event: serde_json::Value,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        self.send_message(
            EntityType::User.with_entity_str(user_id),
            REFRESH_EMAIL.to_string(),
            event,
        )
        .await
    }

    /// Trigger a refresh for everyone reading an inbox. User ids hold email
    /// addresses, so they stay out of the span.
    #[tracing::instrument(skip_all, fields(users = user_ids.len()))]
    pub async fn refresh_email_for_users(
        &self,
        user_ids: &[String],
        event: serde_json::Value,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        self.batch_send_message(
            REFRESH_EMAIL.to_string(),
            event,
            user_ids
                .iter()
                .map(|user_id| EntityType::User.with_entity_str(user_id))
                .collect(),
        )
        .await
    }
}
