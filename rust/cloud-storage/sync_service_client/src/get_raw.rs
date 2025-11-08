use super::SyncServiceClient;
use anyhow::Result;

impl SyncServiceClient {
    pub async fn get_raw(&self, document_id: &str) -> Result<String> {
        let full_url = format!("{}/document/{}/raw", self.url, document_id);
        let res = self.client.get(&full_url).send().await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service while getting raw document"
            );
            return Err(anyhow::anyhow!(body));
        }

        let raw = res.text().await?;

        Ok(raw)
    }
}
