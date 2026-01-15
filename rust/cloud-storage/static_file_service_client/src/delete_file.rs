use super::StaticFileServiceClient;
use anyhow::Result;

impl StaticFileServiceClient {
    /// delete file. propagate error upwards - some callers might see 404 as error, and some as success
    pub async fn delete_file(&self, file_id: &str) -> Result<reqwest::StatusCode> {
        let response = self
            .client
            .delete(format!("{}/internal/file/{}", self.url, file_id))
            .send()
            .await?
            .error_for_status()?;

        Ok(response.status())
    }
}
