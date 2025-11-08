use email_service_client::EmailServiceClient;
use models_email::email::service::message::ParsedMessage;

use anyhow::Result;
use email_service_client;
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
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_email_message_by_id(
        &self,
        message_id: &str,
        jwt_token: Option<&str>,
    ) -> Result<ParsedMessage> {
        match jwt_token {
            Some(token) => {
                self.inner
                    .get_message_by_id_external(message_id, token)
                    .await
            }
            None => self.inner.get_message_by_id_internal(message_id).await,
        }
    }

    /// Get multiple email messages by IDs in batch
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_email_messages_by_id_batch(
        &self,
        message_ids: &[String],
        jwt_token: Option<&str>,
    ) -> Result<Vec<ParsedMessage>> {
        match jwt_token {
            Some(token) => {
                self.inner
                    .get_message_by_id_batch_external(message_ids, token)
                    .await
            }
            None => {
                self.inner
                    .get_message_by_id_batch_internal(message_ids)
                    .await
            }
        }
    }

    /// Get messages by thread ID with pagination
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_email_messages_by_thread_id(
        &self,
        thread_id: &str,
        message_offset: i64,
        message_limit: i64,
        jwt_token: Option<&str>,
    ) -> Result<Vec<ParsedMessage>> {
        match jwt_token {
            Some(token) => {
                self.inner
                    .get_messages_by_thread_id_external(
                        thread_id,
                        message_offset,
                        message_limit,
                        token,
                    )
                    .await
            }
            None => {
                self.inner
                    .get_messages_by_thread_id_internal(thread_id, message_offset, message_limit)
                    .await
            }
        }
    }
}
