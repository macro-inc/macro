use super::ConnectionGatewayClient;
use connection_gateway_models::MessageReceipt;
use serde_json::json;

impl ConnectionGatewayClient {
    /// Send a project update notification
    #[tracing::instrument(skip(self))]
    pub async fn project_update(&self, project_id: &str) -> anyhow::Result<Vec<MessageReceipt>> {
        tracing::info!(project_id, "sending project update");
        self.send_message(
            "project",
            project_id,
            "update".to_string(),
            json!(project_id),
        )
        .await
    }
}
