use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use model::comms::GetMessageWithContextResponse;
use uuid::Uuid;

impl CommsServiceClient {
    /// Get messages with context around a specific message
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_message_with_context(
        &self,
        message_id: &Uuid,
        before: i64,
        after: i64,
        jwt_token: &str,
    ) -> Result<GetMessageWithContextResponse, ClientError> {
        let url = format!(
            "{}/channels/messages/context?message_id={}&before={}&after={}",
            self.url, message_id, before, after
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<GetMessageWithContextResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_message_with_context: {}",
                    e.to_string()
                ))
            })?;

        Ok(result)
    }
}
