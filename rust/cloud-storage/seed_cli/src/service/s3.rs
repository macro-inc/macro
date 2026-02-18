//! S3 service wrapper.

#[cfg(test)]
pub use MockSeedS3 as S3;
#[cfg(not(test))]
pub use SeedS3 as S3;

use anyhow::Context;
#[allow(unused_imports)]
use mockall::automock;

/// Wrapper around the database connection pool.
pub struct SeedS3 {
    bucket: String,
    /// The macrodb pool
    inner: aws_sdk_s3::Client,
}

#[cfg_attr(test, automock)]
impl SeedS3 {
    /// Create a new database wrapper.
    pub fn new(bucket: &str, inner: aws_sdk_s3::Client) -> Self {
        Self {
            bucket: bucket.to_string(),
            inner,
        }
    }

    /// Upload a file to s3
    #[tracing::instrument(skip(self), err)]
    pub async fn upload_file(&self, key: &str, local_file_path: &str) -> anyhow::Result<()> {
        let bytes = std::fs::read(local_file_path).context("read file")?;
        let body = aws_sdk_s3::primitives::ByteStream::from(bytes);

        self.inner
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(body)
            .send()
            .await?;

        Ok(())
    }
}
