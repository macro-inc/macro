//! S3 adapter for generating presigned upload URLs and direct S3 storage operations.

use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::{presigning::PresigningConfig, primitives::ByteStream};
use base64::Engine;
use model::document::ContentType;
use s3_key::SYNC_SERVICE_SNAPSHOT_PREFIX;

use crate::domain::ports::PresignedUploadUrlPort;

fn snapshot_key(document_id: &str) -> String {
    format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{document_id}")
}

/// Adapter implementing [`PresignedUploadUrlPort`] backed by an `aws_sdk_s3::Client`.
pub struct S3UploadUrlAdapter {
    client: aws_sdk_s3::Client,
    document_storage_bucket: String,
    docx_upload_bucket: String,
}

impl S3UploadUrlAdapter {
    /// Create a new adapter with the given S3 client and bucket names.
    pub fn new(
        client: aws_sdk_s3::Client,
        document_storage_bucket: impl Into<String>,
        docx_upload_bucket: impl Into<String>,
    ) -> Self {
        Self {
            client,
            document_storage_bucket: document_storage_bucket.into(),
            docx_upload_bucket: docx_upload_bucket.into(),
        }
    }
}

impl PresignedUploadUrlPort for S3UploadUrlAdapter {
    #[tracing::instrument(skip(self), err)]
    async fn put_document_storage_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url(
            &self.client,
            &self.document_storage_bucket,
            key,
            sha,
            content_type,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn put_docx_upload_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url(
            &self.client,
            &self.docx_upload_bucket,
            key,
            sha,
            content_type,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn copy_object(&self, source_key: &str, destination_key: &str) -> anyhow::Result<()> {
        if macro_aws_config::is_local_aws() {
            return Ok(());
        }

        self.client
            .copy_object()
            .bucket(&self.document_storage_bucket)
            .copy_source(format!("{}/{}", self.document_storage_bucket, source_key))
            .key(destination_key)
            .send()
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_snapshot(&self, document_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let key = snapshot_key(document_id);

        let resp = self
            .client
            .get_object()
            .bucket(&self.document_storage_bucket)
            .key(&key)
            .send()
            .await;

        match resp {
            Err(e) if e.as_service_error().map(|e| e.is_no_such_key()) == Some(true) => Ok(None),
            Err(e) => Err(e).context("failed get_object for snapshot"),
            Ok(output) => {
                let bytes = output
                    .body
                    .collect()
                    .await
                    .context("failed to read snapshot body")?
                    .into_bytes()
                    .to_vec();
                Ok(Some(bytes))
            }
        }
    }

    #[tracing::instrument(skip(self, bytes), err)]
    async fn upload_snapshot(&self, document_id: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        if macro_aws_config::is_local_aws() {
            return Ok(());
        }

        let key = snapshot_key(document_id);
        self.client
            .put_object()
            .bucket(&self.document_storage_bucket)
            .key(&key)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .context("failed to upload snapshot")?;

        Ok(())
    }
}

async fn put_presigned_url(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    sha: &str,
    content_type: ContentType,
) -> anyhow::Result<String> {
    let expiry_duration = Duration::from_secs(2 * 60);

    let payload_sha256_bytes = hex::decode(sha).context("able to decode hex sha")?;
    let base64_encoded_sha = base64::engine::general_purpose::STANDARD.encode(payload_sha256_bytes);

    tracing::trace!("sha info {sha} {base64_encoded_sha}");

    let presigned_url = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .content_type(content_type.mime_type())
        .checksum_sha256(base64_encoded_sha)
        .presigned(PresigningConfig::expires_in(expiry_duration)?)
        .await?;

    Ok(macro_aws_config::transform_aws_url(presigned_url.uri()))
}
