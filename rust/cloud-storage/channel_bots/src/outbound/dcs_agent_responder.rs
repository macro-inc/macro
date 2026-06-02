//! Document cognition service adapter for channel bot responses.

use async_trait::async_trait;
use document_cognition_service_client::DocumentCognitionServiceClient;

use crate::domain::ports::AgentResponder;

/// [`AgentResponder`] backed by the document cognition service.
#[derive(Clone)]
pub struct DcsAgentResponder {
    client: DocumentCognitionServiceClient,
}

impl DcsAgentResponder {
    /// Create a responder from a DCS client.
    pub fn new(client: DocumentCognitionServiceClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl AgentResponder for DcsAgentResponder {
    async fn respond(&self, user_id: &str, prompt: String) -> anyhow::Result<String> {
        self.client
            .channel_respond(user_id, prompt)
            .await
            .map_err(Into::into)
    }
}
