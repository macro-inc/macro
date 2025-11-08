use crate::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use model::comms::ChannelParticipant;

impl CommsServiceClient {
    /// Returns the participants in a channel.
    #[tracing::instrument(skip(self))]
    pub async fn get_channel_participants(
        &self,
        channel_id: &str,
    ) -> Result<Vec<ChannelParticipant>, ClientError> {
        let res = self
            .client
            .get(format!(
                "{}/internal/get_channel_participants/{channel_id}",
                self.url
            ))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = res.json::<Vec<ChannelParticipant>>().await.map_err(|e| {
            ClientError::Generic(anyhow::anyhow!(
                "unable to parse response from get_channel_participants: {}",
                e.to_string()
            ))
        })?;

        Ok(result)
    }
}
