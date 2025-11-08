use super::ConnectionGatewayClient;
use crate::model::sender::MessageReceipt;
use serde_json::json;

impl ConnectionGatewayClient {
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
