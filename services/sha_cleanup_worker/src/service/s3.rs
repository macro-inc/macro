mod delete;

use aws_sdk_s3 as s3;
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
    /// Document storage bucket
    bucket: String,
}

#[cfg_attr(test, automock)]
impl S3Client {
    pub fn new(inner: s3::Client, bucket: &str) -> Self {
        Self {
            inner,
            bucket: bucket.to_string(),
        }
    }

    pub async fn delete_sha(&self, sha: &str) -> Result<(), anyhow::Error> {
        delete::delete_object(&self.inner, &self.bucket, sha).await
    }

    pub async fn delete_objects(&self, objects: Vec<String>) -> Result<(), anyhow::Error> {
        delete::delete_objects(&self.inner, &self.bucket, objects).await
    }
}
