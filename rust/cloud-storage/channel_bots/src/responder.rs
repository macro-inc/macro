//! The agent seam: produce a Macro AI response for a channel message.

use async_trait::async_trait;
use document_cognition_service_client::DocumentCognitionServiceClient;

/// Produces an assistant response for a channel message. Behind a trait so the
/// (cross-service) agent call is isolated and easy to substitute in tests.
#[async_trait]
pub trait AgentResponder: Send + Sync {
    /// Run the agent on behalf of `user_id` with `prompt`, returning the reply.
    async fn respond(&self, user_id: &str, prompt: String) -> anyhow::Result<String>;
}

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
