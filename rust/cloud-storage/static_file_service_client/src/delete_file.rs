use super::StaticFileServiceClient;
use anyhow::Result;

impl StaticFileServiceClient {
    pub async fn delete_file(&self, file_id: &str) -> Result<()> {
        self.client
            .delete(format!("{}/internal/file/{}", self.url, file_id))
            .send()
            .await?;

        Ok(())
    }
}
