use anyhow::{Context, Result};
use aws_sdk_s3::{self, presigning::PresigningConfig};
use std::time::Duration;

#[derive(Debug)]
pub struct S3Client {
    inner: aws_sdk_s3::Client,
    storage_bucket: String,
}

impl S3Client {
    pub fn new(inner: aws_sdk_s3::Client, storage_bucket: String) -> Self {
        S3Client {
            inner,
            storage_bucket,
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn put_presigned_url(&self, key: String, content_type: String) -> Result<String> {
        let duration = Duration::from_secs(2 * 60);
        let presigned_url = self
            .inner
            .put_object()
            .key(key)
            .content_type(content_type)
            .bucket(self.storage_bucket.clone())
            .presigned(PresigningConfig::expires_in(duration)?)
            .await
            .context("failed to create presigned url")?;

        Ok(presigned_url.uri().to_string())
    }

    #[tracing::instrument(skip(self))]
    pub async fn hard_delete_object(&self, key: String) -> Result<()> {
        self.inner
            .delete_object()
            .key(key)
            .bucket(self.storage_bucket.clone())
            .send()
            .await
            .context("failed to delete object")?;
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_presigned_url(&self, key: String) -> Result<String> {
        let presigned_url = self
            .inner
            .get_object()
            .bucket(self.storage_bucket.clone())
            .key(key)
            .presigned(
                aws_sdk_s3::presigning::PresigningConfig::expires_in(
                    std::time::Duration::from_secs(3600), // 1 hour
                )
                .context("failed to create presigning config")?,
            )
            .await
            .context("failed to create presigned URL")?;

        Ok(presigned_url.uri().to_string())
    }
}
