use super::SyncServiceClient;
use anyhow::Result;
use model::sync_service::SyncServiceVersionID;

#[derive(serde::Serialize)]
struct CopyDocumentRequest {
    pub target_document_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<SyncServiceVersionID>,
}

impl SyncServiceClient {
    /// Copies a document from one ID to another.
    pub async fn copy_document(
        &self,
        original_document_id: &str,
        target_document_id: &str,
        version_id: Option<SyncServiceVersionID>,
    ) -> Result<()> {
        let full_url = format!("{}/document/{}/copy", self.url, original_document_id);
        let request_body = CopyDocumentRequest {
            target_document_id: target_document_id.to_string(),
            version_id,
        };
        let res = self
            .client
            .post(&full_url)
            .json(&request_body)
            .send()
            .await?;

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

        Ok(())
    }
}
