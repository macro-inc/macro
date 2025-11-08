use crate::error::{ClientError, ResponseExt};
use model::comms::{AddUserToOrgChannelsRequest, RemoveUserFromOrgChannelsRequest};

use super::CommsServiceClient;

impl CommsServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn add_user_to_org_channels(
        &self,
        user_id: &str,
        org_id: &i64,
    ) -> Result<(), ClientError> {
        let body = serde_json::to_value(AddUserToOrgChannelsRequest {
            user_id: user_id.to_string(),
            org_id: *org_id,
        })
        .map_err(|e| ClientError::Generic(anyhow::anyhow!(e.to_string())))?;

        self.client
            .post(format!("{}/internal/add_user_to_org_channels", self.url))
            .json(&body)
            .send()
            .await
            .map_client_error()
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn remove_user_from_org_channels(
        &self,
        user_id: &str,
        org_id: &i64,
    ) -> Result<(), ClientError> {
        let body = serde_json::to_value(RemoveUserFromOrgChannelsRequest {
            user_id: user_id.to_string(),
            org_id: *org_id,
        })
        .map_err(|e| ClientError::Generic(anyhow::anyhow!(e.to_string())))?;

        self.client
            .post(format!(
                "{}/internal/remove_user_from_org_channels",
                self.url
            ))
            .json(&body)
            .send()
            .await
            .map_client_error()
            .await?;

        Ok(())
    }
}
