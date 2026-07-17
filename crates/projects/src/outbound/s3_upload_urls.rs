//! S3 adapter for project upload destinations.

use std::time::Duration;

use anyhow::Context;
use aws_sdk_s3::presigning::PresigningConfig;
use base64::Engine;
use model::document::{ContentType, FileType};
use s3_key::BulkUploadStagingKey;

use crate::domain::ports::ProjectUploadUrlPort;

/// S3-backed adapter for project upload URLs and bucket destinations.
#[derive(Clone, Debug)]
pub struct S3ProjectUploadAdapter {
    client: aws_sdk_s3::Client,
    document_storage_bucket: String,
    docx_upload_bucket: String,
    upload_zip_staging_bucket: String,
}

impl S3ProjectUploadAdapter {
    /// Create an upload adapter with the document, DOCX staging, and ZIP staging buckets.
    pub fn new(
        client: aws_sdk_s3::Client,
        document_storage_bucket: impl Into<String>,
        docx_upload_bucket: impl Into<String>,
        upload_zip_staging_bucket: impl Into<String>,
    ) -> Self {
        Self {
            client,
            document_storage_bucket: document_storage_bucket.into(),
            docx_upload_bucket: docx_upload_bucket.into(),
            upload_zip_staging_bucket: upload_zip_staging_bucket.into(),
        }
    }
}

impl ProjectUploadUrlPort for S3ProjectUploadAdapter {
    #[tracing::instrument(skip(self), err)]
    async fn put_upload_zip_staging_presigned_url(
        &self,
        key: BulkUploadStagingKey,
        sha: String,
    ) -> anyhow::Result<String> {
        put_presigned_url(
            &self.client,
            &self.upload_zip_staging_bucket,
            &key.to_key(),
            &sha,
            FileType::Zip.into(),
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn put_document_storage_presigned_url(
        &self,
        key: String,
        sha: String,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url(
            &self.client,
            &self.document_storage_bucket,
            &key,
            &sha,
            content_type,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn put_docx_upload_presigned_url(
        &self,
        key: String,
        sha: String,
        content_type: ContentType,
    ) -> anyhow::Result<String> {
        put_presigned_url(
            &self.client,
            &self.docx_upload_bucket,
            &key,
            &sha,
            content_type,
        )
        .await
    }

    fn document_storage_bucket(&self) -> &str {
        &self.document_storage_bucket
    }

    fn docx_upload_bucket(&self) -> &str {
        &self.docx_upload_bucket
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
