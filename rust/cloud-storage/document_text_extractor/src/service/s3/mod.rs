mod get_document_bytes;
use anyhow::Result;
use aws_sdk_s3 as s3;
use lambda_runtime::tracing;
#[allow(unused_imports)]
use mockall::automock;

#[cfg(test)]
pub use MockS3Client as S3;
#[cfg(not(test))]
pub use S3Client as S3;

#[derive(Clone, Debug)]
pub struct S3Client {
    /// Inner S3 client
    inner: s3::Client,
}

#[cfg_attr(test, automock)]
impl S3Client {
    pub fn new(inner: s3::Client) -> Self {
        Self { inner }
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_document_bytes(&self, bucket: &str, key: &str) -> Result<Vec<u8>> {
        get_document_bytes::get_document_bytes(&self.inner, bucket, key).await
    }
}
