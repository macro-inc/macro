use super::StaticFileServiceClient;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkDeleteRequest {
    pub file_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResult {
    pub file_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkDeleteResponse {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub results: Vec<DeleteResult>,
}

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

    /// bulk delete files. returns detailed results for each file
    pub async fn bulk_delete_files(&self, file_ids: Vec<String>) -> Result<BulkDeleteResponse> {
        let request = BulkDeleteRequest { file_ids };

        let response = self
            .client
            .post(format!("{}/internal/file/bulk-delete", self.url))
            .json(&request)
            .send()
            .await?
            .error_for_status()?;

        let bulk_response = response.json::<BulkDeleteResponse>().await?;
        Ok(bulk_response)
    }
}
