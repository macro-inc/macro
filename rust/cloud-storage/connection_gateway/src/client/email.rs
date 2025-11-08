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
}
