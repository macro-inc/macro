use super::DocumentCognitionServiceClient;
use crate::error::DcsClientError;

impl DocumentCognitionServiceClient {
    /// Gets the users that need to be notified for a given chat
    #[tracing::instrument(skip(self))]
    pub async fn get_chat_notification_users(
        &self,
        chat_id: &str,
    ) -> Result<Vec<String>, DcsClientError> {
        let res = self
            .client
            .get(format!(
                "{}/internal/notifications/chat/{chat_id}",
                self.url
            ))
            .send()
            .await
            .map_err(|e| DcsClientError::RequestBuildError {
                details: e.to_string(),
            })?;

        Self::handle_response(res, "chat notification users retrieval").await
    }
}
