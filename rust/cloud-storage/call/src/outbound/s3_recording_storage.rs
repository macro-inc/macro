//! S3-backed implementation of [`RecordingStorage`](crate::domain::ports::RecordingStorage).

use std::time::Duration;

use crate::domain::ports::RecordingStorage;

/// Presigned-URL generator backed by an S3 client from [`macro_aws_config`].
pub struct S3RecordingStorage {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3RecordingStorage {
    /// Build using the shared AWS config from [`macro_aws_config`] and
    /// the bucket name from the egress configuration.
    pub async fn new(bucket: String) -> Self {
        let client = macro_aws_config::s3_client().await;
        Self { client, bucket }
    }
}

fn recording_object_key(recording_key: &str) -> String {
    format!("calls/{recording_key}")
}

fn preview_object_key(preview_key: &str) -> &str {
    preview_key
}

impl RecordingStorage for S3RecordingStorage {
    async fn presign_recording_url(&self, recording_key: &str) -> anyhow::Result<String> {
        let full_key = recording_object_key(recording_key);
        let presigning_config =
            aws_sdk_s3::presigning::PresigningConfig::expires_in(Duration::from_secs(3600))?;

        let presigned = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(full_key)
            .presigned(presigning_config)
            .await?;

        Ok(macro_aws_config::transform_aws_url(presigned.uri()))
    }

    async fn presign_recording_preview_url(&self, preview_key: &str) -> anyhow::Result<String> {
        let presigning_config =
            aws_sdk_s3::presigning::PresigningConfig::expires_in(Duration::from_secs(3600))?;

        let presigned = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(preview_object_key(preview_key))
            .presigned(presigning_config)
            .await?;

        Ok(macro_aws_config::transform_aws_url(presigned.uri()))
    }

    async fn delete_recording(&self, recording_key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(recording_object_key(recording_key))
            .send()
            .await?;
        Ok(())
    }

    async fn delete_recording_preview(&self, preview_key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(preview_object_key(preview_key))
            .send()
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn recording_object_key_adds_calls_prefix() {
        assert_eq!(
            recording_object_key("room/recording.mp4"),
            "calls/room/recording.mp4"
        );
    }

    #[test]
    fn preview_object_key_uses_stored_key_path_without_prefix_changes() {
        assert_eq!(
            preview_object_key("calls/room/recording/PREVIEW.jpg"),
            "calls/room/recording/PREVIEW.jpg"
        );
    }
}
