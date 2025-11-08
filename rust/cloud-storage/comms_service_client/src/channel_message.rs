use model::comms::GetChannelMessageResponse;

use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};

impl CommsServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn get_channel_message(
        &self,
        channel_id: &str,
        message_id: &str,
    ) -> Result<GetChannelMessageResponse, ClientError> {
        let response = self
            .client
            .get(format!(
                "{}/internal/channel/{}/{}",
                self.url, channel_id, message_id
            ))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<GetChannelMessageResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channel_message: {}",
                    e.to_string()
                ))
            })?;

        Ok(result)
    }
}
