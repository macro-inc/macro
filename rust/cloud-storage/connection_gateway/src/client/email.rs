use crate::{client::ConnectionGatewayClient, model::sender::MessageReceipt};
use serde_json::json;

impl ConnectionGatewayClient {
    // trigger refresh of the user's emails
    #[tracing::instrument(skip(self))]
    pub async fn refresh_email(
        &self,
        user_id: &str,
        event_type: &str,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        self.send_message(
            "user",
            user_id,
            "refresh_email".to_string(),
            json!(event_type),
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn invalidate_contacts(&self, user_id: &str) -> anyhow::Result<Vec<MessageReceipt>> {
        self.send_message(
            "user",
            user_id,
            "contacts_invalidation".to_string(),
            json!({}),
        )
        .await
    }
}
