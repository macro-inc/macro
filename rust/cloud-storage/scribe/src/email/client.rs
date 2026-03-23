use email_service_client::EmailServiceClient;
use models_email::email::service::message::ParsedMessage;

use anyhow::Result;
use std::sync::Arc;

#[derive(Clone)]
pub struct EmailClient {
    inner: Arc<EmailServiceClient>,
}

impl EmailClient {
    pub fn new(inner: Arc<EmailServiceClient>) -> Self {
        Self { inner }
    }
}

impl EmailClient {
    /// Get a single email message by ID
    #[tracing::instrument(skip(self), err)]
    pub async fn get_email_message_by_id(&self, message_id: &str) -> Result<ParsedMessage> {
        self.inner.get_message_by_id_internal(message_id).await
    }

    /// Get messages by thread ID with pagination
    #[tracing::instrument(skip(self), err)]
    pub async fn get_email_messages_by_thread_id(
        &self,
        thread_id: &str,
        message_offset: i64,
        message_limit: i64,
    ) -> Result<Vec<ParsedMessage>> {
        self.inner
            .get_messages_by_thread_id_internal(thread_id, message_offset, message_limit)
            .await
    }
}
