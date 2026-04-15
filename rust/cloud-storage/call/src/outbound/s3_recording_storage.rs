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

impl RecordingStorage for S3RecordingStorage {
    async fn presign_recording_url(&self, recording_key: &str) -> anyhow::Result<String> {
        let full_key = format!("calls/{recording_key}");
        let presigning_config =
            aws_sdk_s3::presigning::PresigningConfig::expires_in(Duration::from_secs(3600))?;

        let presigned = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&full_key)
            .presigned(presigning_config)
            .await?;

        Ok(macro_aws_config::transform_aws_url(presigned.uri()))
    }
}
