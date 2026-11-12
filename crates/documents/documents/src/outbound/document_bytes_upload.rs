//! Outbound adapter for uploading document bytes to presigned object-storage URLs.

use crate::domain::models::DocumentError;
use crate::domain::ports::create::{DocumentBytesUpload, DocumentBytesUploadPort};

/// Document bytes uploader backed by reqwest.
#[derive(Clone)]
pub struct ReqwestDocumentBytesUploader {
    http_client: reqwest::Client,
}

impl ReqwestDocumentBytesUploader {
    /// Construct a reqwest-backed document bytes uploader.
    pub fn new(http_client: reqwest::Client) -> Self {
        Self { http_client }
    }
}

impl Default for ReqwestDocumentBytesUploader {
    fn default() -> Self {
        Self::new(reqwest::Client::new())
    }
}

impl DocumentBytesUploadPort for ReqwestDocumentBytesUploader {
    async fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> Result<(), DocumentError> {
        // The document service mints the presigned URL for a browser on the
        // host (`localhost:4566`); this uploader runs inside the Docker
        // network and has to use LocalStack's own hostname to reach the same
        // object. No-op outside local AWS.
        let presigned_url =
            macro_aws_config::transform_aws_url_for_internal_fetch(&upload.presigned_url);
        let upload_response = self
            .http_client
            .put(&presigned_url)
            .header("content-type", &upload.content_type)
            .header("x-amz-checksum-sha256", &upload.base64_sha256)
            .body(upload.bytes)
            .send()
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let body = upload_response.text().await.unwrap_or_default();
            return Err(DocumentError::Internal(anyhow::anyhow!(
                "presigned url upload failed: {status} {body}"
            )));
        }

        Ok(())
    }
}
