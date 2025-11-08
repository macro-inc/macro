use super::DocumentStorageServiceClient;
use anyhow::Result;
use model::document_storage_service_internal::UpdateUserChannelPermissionsRequest;

impl DocumentStorageServiceClient {
    /// Updates permissions for users in a channel by either adding, replacing, or removing
    /// access to all items shared with that channel.
    #[tracing::instrument(skip(self))]
    pub async fn update_user_channel_permissions(
        &self,
        req: UpdateUserChannelPermissionsRequest,
    ) -> Result<()> {
        let res = self
            .client
            .post(format!(
                "{}/internal/channel/update_user_channel_permissions",
                self.url
            ))
            .json(&req)
            .send()
            .await?;

        let status_code = res.status();

        match status_code {
            reqwest::StatusCode::OK => {
                tracing::trace!("user channel permissions updated successfully");
                Ok(())
            }
            _ => {
                let body: String = res.text().await?;
                tracing::error!(
                    body=%body,
                    status=%status_code,
                    "unexpected response from document storage service"
                );
                Err(anyhow::anyhow!(body))
            }
        }
    }
}
