use super::DocumentStorageServiceClient;
use anyhow::Result;
use model::document_storage_service_internal::UpdateChannelSharePermissionRequest;

impl DocumentStorageServiceClient {
    #[tracing::instrument(skip(self))]
    pub async fn update_channel_share_permission(
        &self,
        req: UpdateChannelSharePermissionRequest,
    ) -> Result<()> {
        let res = self
            .client
            .post(format!(
                "{}/internal/channel/update_share_permission",
                self.url
            ))
            .json(&req)
            .send()
            .await?;

        let status_code = res.status();

        match status_code {
            reqwest::StatusCode::OK => {
                tracing::trace!("channel share permission updated");
                return Ok(());
            }
            reqwest::StatusCode::NOT_MODIFIED => {
                tracing::trace!("channel share permission not modified");
                return Ok(());
            }
            _ => {
                let body: String = res.text().await?;
                tracing::error!(
                    body=%body,
                    status=%status_code,
                    "unexpected response from document storage service"
                );
                return Err(anyhow::anyhow!(body));
            }
        }
    }
}
