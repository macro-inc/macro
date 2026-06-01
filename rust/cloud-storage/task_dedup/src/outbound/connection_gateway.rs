//! Connection-gateway live-update adapter.

use std::sync::Arc;

use async_trait::async_trait;
use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::EntityType;
use serde_json::json;

use crate::domain::ports::TaskDedupNotifier;

const TASK_DUPLICATE_MATCHES_UPDATED_MESSAGE_TYPE: &str = "task_duplicate_matches_updated";

/// Notifier that sends document-scoped live updates through connection gateway.
pub struct ConnectionGatewayTaskDedupNotifier {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayTaskDedupNotifier {
    /// Creates a connection-gateway notifier.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

#[async_trait]
impl TaskDedupNotifier for ConnectionGatewayTaskDedupNotifier {
    async fn notify_matches_updated(&self, document_id: &str) -> anyhow::Result<()> {
        let payload = json!({ "documentId": document_id });
        let entity = EntityType::Document.with_entity_str(document_id);
        self.client
            .send_message(
                entity,
                TASK_DUPLICATE_MATCHES_UPDATED_MESSAGE_TYPE.to_string(),
                payload,
            )
            .await?;
        Ok(())
    }
}

/// No-op notifier.
pub struct NoopTaskDedupNotifier;

#[async_trait]
impl TaskDedupNotifier for NoopTaskDedupNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}
