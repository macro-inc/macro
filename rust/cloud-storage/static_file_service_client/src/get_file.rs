use models_sfs::FileMetadata;

use super::StaticFileServiceClient;
use anyhow::Result;

impl StaticFileServiceClient {
    #[tracing::instrument(skip(self), err)]
    /// Read file content directly from distribution
    pub async fn read_file(&self, file_id: &str) -> Result<bytes::Bytes> {
        let full_url = format!("{}/file/{}", self.url, file_id);

        let response = self.client.get(&full_url).send().await?;

        let status_code = response.status();

        if status_code == reqwest::StatusCode::NOT_FOUND {
            return Err(anyhow::anyhow!("File not found: {}", file_id));
        }

        if !status_code.is_success() {
            let body: String = response.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from static file service"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let file_bytes = response.bytes().await?;
        Ok(file_bytes)
    }

    #[tracing::instrument(skip(self), err)]
    /// Get file metadata from static file service
    pub async fn get_file_metadata(&self, file_id: &str) -> Result<Option<FileMetadata>> {
        let full_url = format!("{}/internal/file/metadata/{}", self.url, file_id);

        let response = self.client.get(&full_url).send().await?;

        let status_code = response.status();

        if status_code == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !status_code.is_success() {
            let body: String = response.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from static file service"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let metadata: FileMetadata = response.json().await?;
        Ok(Some(metadata))
    }

    #[tracing::instrument(skip(self), err)]
    /// Get presigned URL for file from static file service
    pub async fn get_presigned_url(&self, file_id: &str) -> Result<String> {
        let full_url = format!("{}/internal/file/{}/presigned-url", self.url, file_id);

        let response = self.client.get(&full_url).send().await?;

        let status_code = response.status();

        if status_code == reqwest::StatusCode::NOT_FOUND {
            return Err(anyhow::anyhow!("File not found: {}", file_id));
        }

        if !status_code.is_success() {
            let body: String = response.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from static file service"
            );
            return Err(anyhow::anyhow!("HTTP {}: {}", status_code, body));
        }

        let presigned_url = response.text().await?;
        Ok(presigned_url)
    }
}
