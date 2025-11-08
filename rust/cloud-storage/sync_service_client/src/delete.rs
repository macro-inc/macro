use super::SyncServiceClient;
use anyhow::Result;

impl SyncServiceClient {
    pub async fn delete(&self, document_id: &str) -> Result<()> {
        let full_url = format!("{}/document/{}/delete", self.url, document_id);
        let res = self.client.delete(&full_url).send().await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "could not delete document from sync service"
            );
            return Err(anyhow::anyhow!(body));
        }

        Ok(())
    }
}
