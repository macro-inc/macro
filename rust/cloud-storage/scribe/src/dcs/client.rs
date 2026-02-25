use anyhow::{Error, Result};
use document_cognition_service_client::DocumentCognitionServiceClient;
pub use model::chat::ChatHistory;
use std::sync::Arc;

#[derive(Clone)]
pub struct DcsClient {
    inner: Arc<DocumentCognitionServiceClient>,
}

impl DcsClient {
    pub fn new(inner: Arc<DocumentCognitionServiceClient>) -> Self {
        Self { inner }
    }
}

impl DcsClient {
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_chat_history(&self, chat_id: &str, jwt_token: &str) -> Result<ChatHistory> {
        self.inner
            .get_chat_history_external(chat_id, jwt_token)
            .await
            .map_err(Error::from)
    }

    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_chat_history_for_messages(
        &self,
        message_ids: &[String],
        jwt_token: &str,
    ) -> Result<ChatHistory> {
        self.inner
            .get_chat_history_for_messages_external(message_ids, jwt_token)
            .await
            .map_err(Error::from)
    }
}
