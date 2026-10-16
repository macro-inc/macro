//! Version-aware cleanup for opaque objects in the existing email temp namespace.

use super::repository::failure;
use crate::domain::{
    models::MessagingError,
    ports::{MediaBytes, PortResult},
    temporary_media::{MEDIA_URL_SECONDS, MediaCopyStorage, copy_key},
};
use async_trait::async_trait;
use aws_sdk_s3::{Client, presigning::PresigningConfig, primitives::ByteStream};
use std::time::Duration;
use uuid::Uuid;

/// The application composition supplies Macro's configured AWS client.
pub struct S3MediaCopies {
    client: Client,
}
impl S3MediaCopies {
    /// Reuse the existing email attachment bucket; never use a native document key.
    pub fn new(client: Client) -> Self {
        Self { client }
    }
    async fn remove_versions(&self, bucket: &str, id: Uuid) -> PortResult<bool> {
        let key = copy_key(id);
        let listing = self
            .client
            .list_object_versions()
            .bucket(bucket)
            .prefix(&key)
            .max_keys(100)
            .send()
            .await
            .map_err(failure)?;
        for (object, version) in listing
            .versions()
            .iter()
            .map(|v| (v.key(), v.version_id()))
            .chain(
                listing
                    .delete_markers()
                    .iter()
                    .map(|v| (v.key(), v.version_id())),
            )
        {
            if object != Some(key.as_str()) {
                continue;
            }
            let version = version.ok_or(MessagingError::Unavailable)?;
            self.client
                .delete_object()
                .bucket(bucket)
                .key(&key)
                .version_id(version)
                .send()
                .await
                .map_err(failure)?;
        }
        // Expiration alone, or adding a delete marker, is not physical deletion.
        let remaining = self
            .client
            .list_object_versions()
            .bucket(bucket)
            .prefix(&key)
            .max_keys(100)
            .send()
            .await
            .map_err(failure)?;
        Ok(!remaining.is_truncated().unwrap_or(false)
            && !remaining
                .versions()
                .iter()
                .any(|v| v.key() == Some(key.as_str()))
            && !remaining
                .delete_markers()
                .iter()
                .any(|v| v.key() == Some(key.as_str())))
    }
}
#[async_trait]
impl MediaCopyStorage for S3MediaCopies {
    #[tracing::instrument(skip_all, err)]
    async fn put_copy(&self, bucket: &str, id: Uuid, file: &MediaBytes) -> PortResult<String> {
        tokio::time::timeout(Duration::from_secs(60), async {
            let key = copy_key(id);
            self.client
                .put_object()
                .bucket(bucket)
                .key(&key)
                .content_type(&file.mime_type)
                .body(ByteStream::from(file.bytes.clone()))
                .send()
                .await
                .map_err(failure)?;
            let signed = self
                .client
                .get_object()
                .bucket(bucket)
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
    #[tracing::instrument(skip_all, err)]
    async fn remove_copy(&self, bucket: &str, id: Uuid) -> PortResult<bool> {
        tokio::time::timeout(Duration::from_secs(30), self.remove_versions(bucket, id))
            .await
            .map_err(|_| MessagingError::Unavailable)?
    }
}

#[cfg(test)]
mod test;
