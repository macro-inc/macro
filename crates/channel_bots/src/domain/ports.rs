//! Port definitions for channel bot domain dependencies.

use async_trait::async_trait;

/// Produces an assistant response for a channel message.
#[async_trait]
pub trait AgentResponder: Send + Sync {
    /// Run the agent on behalf of `user_id` with `prompt`, returning the reply.
    async fn respond(&self, user_id: &str, prompt: String) -> anyhow::Result<String>;
}
