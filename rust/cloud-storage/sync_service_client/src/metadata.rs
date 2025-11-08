use model::sync_service::DocumentMetadata;

use super::SyncServiceClient;
use anyhow::Result;

impl SyncServiceClient {
    pub async fn get_metadata(&self, document_id: &str) -> Result<DocumentMetadata> {
        let full_url = format!("{}/document/{}/metadata", self.url, document_id);
        let res = self.client.get(&full_url).send().await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service"
            );
            return Err(anyhow::anyhow!(body));
        }

        let metadata: DocumentMetadata = res.json().await?;

        Ok(metadata)
    }
}
