use super::SyncServiceClient;
use anyhow::Result;
use reqwest::StatusCode;

impl SyncServiceClient {
    pub async fn exists(&self, document_id: &str) -> Result<bool> {
        let full_url = format!("{}/document/{}/exists", self.url, document_id);
        let res = self.client.head(&full_url).send().await?;

        let status_code = res.status();

        if status_code == StatusCode::NOT_FOUND {
            Ok(false)
        } else {
            res.error_for_status()?;
            Ok(true)
        }
    }
}
