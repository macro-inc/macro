use super::DocumentStorageServiceClient;
use anyhow::Result;

impl DocumentStorageServiceClient {
    /// Deletes all items for a user
    #[tracing::instrument(skip(self))]
    pub async fn delete_all_user_items(&self, user_id: &str) -> Result<()> {
        let res = self
            .client
            .delete(format!("{}/internal/users/{}", self.url, user_id))
            .send()
            .await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            return Err(anyhow::anyhow!(body));
        }

        Ok(())
    }
}
