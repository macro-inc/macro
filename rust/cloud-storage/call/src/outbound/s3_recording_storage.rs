//! S3-backed implementation of [`RecordingStorage`](crate::domain::ports::RecordingStorage).

use std::time::Duration;

use crate::domain::models::EgressS3Config;
use crate::domain::ports::RecordingStorage;

/// Presigned-URL generator backed by an S3 client built from egress credentials.
pub struct S3RecordingStorage {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3RecordingStorage {
    /// Build from the egress S3 configuration.
    pub fn new(config: &EgressS3Config) -> Self {
        let creds = aws_sdk_s3::config::Credentials::new(
            &config.access_key,
            &config.secret,
            None,
            None,
            "call-egress",
        );
        let s3_config = aws_sdk_s3::Config::builder()
            .region(aws_sdk_s3::config::Region::new(config.region.clone()))
            .credentials_provider(creds)
            .behavior_version_latest()
            .build();

        Self {
            client: aws_sdk_s3::Client::from_conf(s3_config),
            bucket: config.bucket.clone(),
        }
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

        Ok(presigned.uri().to_string())
    }
}
