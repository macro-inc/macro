use super::StaticFileServiceClient;
use anyhow::{Context, Result};
use bytes::Bytes;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// HACK: duplicate logic. put into model crate later
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PutFileRequest {
    /// file name
    pub file_name: String,
    /// optional mime type if type cannot be infered from file_name
    pub content_type: Option<String>,
    /// extra metadata to store with file
    /// don't put anything private in here it is public
    pub extension_data: Option<Value>,
}

// HACK: duplicate logic. put into model crate later
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PutFileResponse {
    /// expiring url to upload file blob to
    pub upload_url: String,
    /// permalink
    pub file_location: String,
    /// key to retrieve metadata
    pub id: String,
}

impl StaticFileServiceClient {
    pub async fn put_file(&self, file_url: &str) -> Result<PutFileResponse> {
        let response = self.client.get(file_url).send().await?;

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .map(String::from)
            .context("content-type header not found")?;

        let file_bytes = response.bytes().await?;

        self.put_file_with_bytes(file_url, file_bytes, content_type)
            .await
    }

    pub async fn put_file_with_bytes(
        &self,
        file_url: &str,
        file_bytes: Bytes,
        content_type: String,
    ) -> Result<PutFileResponse> {
        self.upload(
            PutFileRequest {
                file_name: file_url.to_string(),
                content_type: Some(content_type.clone()),
                extension_data: None,
            },
            file_bytes,
            &content_type,
        )
        .await
    }

    /// Store `bytes` under a name of the caller's choosing.
    ///
    /// [`Self::put_file_with_bytes`] passes the source URL as the file name,
    /// which is right for a file mirrored from somewhere else and wrong for
    /// bytes that were never at a URL — an artifact downloaded from a
    /// presigned link, whose name is `screenshot.png` and whose link must not
    /// end up in the stored metadata.
    pub async fn put_named_bytes(
        &self,
        file_name: &str,
        bytes: Bytes,
        content_type: &str,
    ) -> Result<PutFileResponse> {
        self.upload(
            PutFileRequest {
                file_name: file_name.to_string(),
                content_type: Some(content_type.to_string()),
                extension_data: None,
            },
            bytes,
            content_type,
        )
        .await
    }

    /// Reserve a file and PUT its bytes to the upload URL that comes back.
    async fn upload(
        &self,
        body: PutFileRequest,
        bytes: Bytes,
        content_type: &str,
    ) -> Result<PutFileResponse> {
        let full_url = format!("{}/internal/file", self.url);
        let res = self.client.put(&full_url).json(&body).send().await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from document storage service"
            );
            anyhow::bail!(body);
        }

        let res = res.json().await?;

        let put_file_data: PutFileResponse = serde_json::from_value(res)?;

        // The service mints the presigned URL for a browser on the host
        // (`LOCAL_AWS_PUBLIC_URL`); an uploader inside the Docker network has
        // to use LocalStack's own endpoint (`LOCAL_AWS_URL`) to reach the same
        // object. No-op outside local AWS.
        let presigned_url =
            macro_aws_config::transform_aws_url_for_internal_fetch(&put_file_data.upload_url);

        let upload_response = self
            .client
            .put(&presigned_url)
            .header(CONTENT_TYPE, content_type)
            .body(bytes.to_vec())
            .send()
            .await?;

        if !upload_response.status().is_success() {
            anyhow::bail!("Upload failed: {}", upload_response.status());
        }

        Ok(put_file_data)
    }
}
