use super::SyncServiceClient;
use anyhow::{Context, Result};

fn encode_initialize_from_snapshot_request(snapshot: &[u8]) -> Result<Vec<u8>> {
    let len = u32::try_from(snapshot.len()).with_context(|| {
        format!(
            "snapshot is too large to encode as sync-service initialize request: {} bytes",
            snapshot.len()
        )
    })?;

    let mut body = Vec::with_capacity(4 + snapshot.len());
    body.extend_from_slice(&len.to_le_bytes());
    body.extend_from_slice(snapshot);
    Ok(body)
}

impl SyncServiceClient {
    pub async fn initialize_from_snapshot(&self, document_id: &str, snapshot: &[u8]) -> Result<()> {
        let full_url = format!("{}/document/{}/initialize", self.url, document_id);
        let body = encode_initialize_from_snapshot_request(snapshot)?;
        let res = self
            .client
            .post(&full_url)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await?;

        let status_code = res.status();
        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service while initializing snapshot"
            );
            anyhow::bail!(body);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::encode_initialize_from_snapshot_request;

    #[test]
    fn test_encode_initialize_from_snapshot_request() {
        let encoded = encode_initialize_from_snapshot_request(&[1, 2, 3]).unwrap();
        assert_eq!(encoded, vec![3, 0, 0, 0, 1, 2, 3]);
    }
}
