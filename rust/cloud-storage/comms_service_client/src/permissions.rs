use uuid::Uuid;

use crate::error::{ClientError, ResponseExt};
use model::comms::CheckChannelsForUserRequest;

use super::CommsServiceClient;

impl CommsServiceClient {
    /// Given a list of channel ids and a user id, this will return all channel ids in the list
    /// that the user is part of.
    #[tracing::instrument(skip(self))]
    pub async fn check_channels_for_user(
        &self,
        user_id: &str,
        channel_ids: &[Uuid],
    ) -> Result<Vec<Uuid>, ClientError> {
        let body = serde_json::to_value(CheckChannelsForUserRequest {
            user_id: user_id.to_string(),
            channel_ids: channel_ids.to_vec(),
        })
        .map_err(|e| ClientError::Generic(anyhow::anyhow!(e.to_string())))?;

        let response = self
            .client
            .post(format!("{}/internal/check_channels_for_user", self.url))
            .json(&body)
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response.json::<Vec<Uuid>>().await.map_err(|e| {
            ClientError::Generic(anyhow::anyhow!(
                "unable to parse response from check_channels_for_user: {}",
                e.to_string()
            ))
        })?;

        Ok(result)
    }
}
