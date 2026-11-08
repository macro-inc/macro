use super::SyncServiceClient;
use anyhow::Result;

impl SyncServiceClient {
    pub async fn get_raw(&self, document_id: &str) -> Result<String> {
        let full_url = format!("{}/document/{}/raw", self.url, document_id);
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let res = self
            .client
            .get(&full_url)
            .headers(headers)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                status=%status_code,
                "unexpected response from sync service while getting raw document"
            );
            anyhow::bail!(body);
        }

        let raw = res.text().await?;

        Ok(raw)
    }
}
