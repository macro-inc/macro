use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use models_comms::mentions::DeleteMentionsRequest;

impl CommsServiceClient {
    /// Given an item id and item type, this will return all channel ids that mention the item
    #[tracing::instrument(skip(self))]
    pub async fn get_channel_mentions(
        &self,
        item_id: &str,
        item_type: &str,
    ) -> Result<Vec<String>, ClientError> {
        let response = self
            .client
            .get(format!(
                "{}/internal/get_channel_mentions/{}/{}",
                self.url, item_id, item_type
            ))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response.json::<Vec<String>>().await.map_err(|e| {
            ClientError::Generic(anyhow::anyhow!(
                "unable to parse response from get_channel_mentions: {}",
                e.to_string()
            ))
        })?;

        Ok(result)
    }

    /// Delete entity mentions by source. Used when we delete the source item
    #[tracing::instrument(skip(self))]
    pub async fn delete_mentions_by_source(
        &self,
        item_ids: Vec<String>,
    ) -> Result<(), ClientError> {
        let req = DeleteMentionsRequest { item_ids };

        self.client
            .delete(format!("{}/internal/delete_mentions_by_source", self.url))
            .json(&req)
            .send()
            .await
            .map_client_error()
            .await?;

        Ok(())
    }
}
