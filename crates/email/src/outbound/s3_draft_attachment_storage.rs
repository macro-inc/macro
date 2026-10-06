//! S3 adapter for the bucket the scheduled sender reads draft attachments
//! from: the same bucket the draft attachment API presigns uploads into.

use anyhow::Context;
use aws_sdk_s3::primitives::ByteStream;

use crate::domain::ports::DraftAttachmentStorage;

/// [`DraftAttachmentStorage`] over an `aws_sdk_s3::Client` and the email
/// attachment bucket.
#[derive(Clone)]
pub struct S3DraftAttachmentStorage {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3DraftAttachmentStorage {
    /// Store attachments in `bucket` through `client`.
    pub fn new(client: aws_sdk_s3::Client, bucket: impl Into<String>) -> Self {
        Self {
            client,
            bucket: bucket.into(),
        }
    }
}

impl DraftAttachmentStorage for S3DraftAttachmentStorage {
    #[tracing::instrument(skip(self, bytes), fields(bucket = %self.bucket, size = bytes.len()), err)]
    async fn put_attachment(
        &self,
        key: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(bytes.to_vec()))
            .send()
            .await
            .with_context(|| format!("storing draft attachment {key}"))?;
        Ok(())
    }
}
