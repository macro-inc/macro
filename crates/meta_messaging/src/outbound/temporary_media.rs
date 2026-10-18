//! Opaque copies in the email bucket temp/ lifecycle namespace.

use super::repository::failure;
use crate::domain::{
    models::MessagingError,
    ports::{MediaBytes, PortResult},
    temporary_media::{MEDIA_URL_SECONDS, TemporaryMedia, copy_key},
};
use async_trait::async_trait;
use aws_sdk_s3::{Client, presigning::PresigningConfig, primitives::ByteStream};
use std::time::Duration;
use uuid::Uuid;

/// The application composition supplies Macro's configured AWS client.
pub struct S3MediaCopies {
    client: Client,
    bucket: String,
}
impl S3MediaCopies {
    /// Reuse the existing email attachment bucket; never use a native document key.
    pub fn new(client: Client, bucket: String) -> Result<Self, MessagingError> {
        if !(3..=63).contains(&bucket.len())
            || !bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'.'))
        {
            return Err(MessagingError::Invalid(
                "temporary media bucket is not configured correctly",
            ));
        }
        Ok(Self { client, bucket })
    }
}
#[async_trait]
impl TemporaryMedia for S3MediaCopies {
    #[tracing::instrument(skip_all, err)]
    async fn stage(&self, file: &MediaBytes) -> PortResult<String> {
        tokio::time::timeout(Duration::from_secs(60), async {
            let key = copy_key(Uuid::now_v7());
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(&key)
                .content_type(&file.mime_type)
                .body(ByteStream::from(file.bytes.clone()))
                .send()
                .await
                .map_err(failure)?;
            let signed = self
                .client
                .get_object()
                .bucket(&self.bucket)
                .key(&key)
                .presigned(
                    PresigningConfig::expires_in(Duration::from_secs(MEDIA_URL_SECONDS))
                        .map_err(failure)?,
                )
                .await
                .map_err(failure)?;
            Ok(signed.uri().to_string())
        })
        .await
        .map_err(|_| MessagingError::Unavailable)?
    }
}

#[cfg(test)]
mod test;
