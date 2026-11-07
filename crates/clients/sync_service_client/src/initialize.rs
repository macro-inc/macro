use super::SyncServiceClient;
use anyhow::{Context, Result};

/// Initialization refused because the session already has its own snapshot.
#[derive(Debug)]
pub struct SnapshotAlreadyExists;

impl std::fmt::Display for SnapshotAlreadyExists {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("snapshot already exists")
    }
}

impl std::error::Error for SnapshotAlreadyExists {}

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
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await?;

        let status_code = res.status();
        if status_code == reqwest::StatusCode::CONFLICT {
            return Err(SnapshotAlreadyExists.into());
        }
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
mod test;
