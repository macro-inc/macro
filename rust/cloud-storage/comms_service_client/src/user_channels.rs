use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};

impl CommsServiceClient {
    /// Get the channel ids that a user is a member of
    #[tracing::instrument(skip(self))]
    pub async fn get_user_channel_ids(
        &self,
        user_id: &str,
        user_org_id: Option<i32>,
    ) -> Result<Vec<String>, ClientError> {
        let url = if let Some(user_org_id) = user_org_id {
            format!(
                "{}/internal/user_channels/{}?org_id={}",
                self.url, user_id, user_org_id
            )
        } else {
            format!("{}/internal/user_channels/{}", self.url, user_id)
        };

        let response = self.client.get(url).send().await.map_client_error().await?;

        let result = response.json::<Vec<String>>().await.map_err(|e| {
            ClientError::Generic(anyhow::anyhow!(
                "unable to parse response from get_user_channel_ids: {}",
                e.to_string()
            ))
        })?;

        Ok(result)
    }
}
