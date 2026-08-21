//! S3-backed recording storage with signed storage or distribution GET URLs.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cloudfront_sign::{SignedOptions, get_signed_url};

use crate::domain::ports::RecordingStorage;

/// CloudFront settings used to sign recording GET URLs.
pub struct RecordingCloudFrontConfig {
    /// CloudFront distribution URL, with or without a trailing slash.
    pub distribution_url: String,
    /// Public key ID associated with the signing private key.
    pub signer_public_key_id: String,
    /// PEM-encoded PKCS#1 private signing key.
    pub signer_private_key: String,
    /// Lifetime of each signed URL in seconds.
    pub presigned_url_expiry_seconds: u64,
}

/// S3-backed recording storage that serves production GETs through CloudFront.
pub struct S3RecordingStorage {
    client: aws_sdk_s3::Client,
    bucket: String,
    cloudfront_config: RecordingCloudFrontConfig,
}

impl S3RecordingStorage {
    /// Build using the shared AWS config, egress bucket, and CloudFront signer.
    pub async fn new(bucket: String, cloudfront_config: RecordingCloudFrontConfig) -> Self {
        let client = macro_aws_config::s3_client().await;
        Self {
            client,
            bucket,
            cloudfront_config,
        }
    }

    async fn presign_s3_url(&self, object_key: &str) -> anyhow::Result<String> {
        let presigning_config = aws_sdk_s3::presigning::PresigningConfig::expires_in(
            Duration::from_secs(self.cloudfront_config.presigned_url_expiry_seconds),
        )?;

        let presigned = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(object_key)
            .presigned(presigning_config)
            .await?;

        Ok(macro_aws_config::transform_aws_url(presigned.uri()))
    }

    fn presign_get_url(&self, object_key: &str) -> anyhow::Result<String> {
        let expires_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs()
            + self.cloudfront_config.presigned_url_expiry_seconds;

        cloudfront_signed_url(&self.cloudfront_config, object_key, expires_at)
    }
}

fn recording_object_key(recording_key: &str) -> String {
    format!("calls/{recording_key}")
}

fn preview_object_key(preview_key: &str) -> &str {
    preview_key
}

fn encode_object_key(object_key: &str) -> String {
    object_key
        .split('/')
        .map(|segment| match segment {
            "." => "%2E".into(),
            ".." => "%2E%2E".into(),
            _ => urlencoding::encode(segment),
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn cloudfront_signed_url(
    config: &RecordingCloudFrontConfig,
    object_key: &str,
    expires_at: u64,
) -> anyhow::Result<String> {
    let distribution_url = config.distribution_url.trim_end_matches('/');
    let has_valid_scheme =
        distribution_url.starts_with("https://") || distribution_url.starts_with("http://");
    let host = distribution_url
        .split_once("://")
        .map(|(_, host)| host)
        .unwrap_or_default();
    if !has_valid_scheme || host.is_empty() || distribution_url.contains(['?', '#']) {
        anyhow::bail!("invalid CloudFront distribution URL");
    }

    let resource_url = format!("{distribution_url}/{}", encode_object_key(object_key));
    let options = SignedOptions {
        key_pair_id: config.signer_public_key_id.clone(),
        private_key: config.signer_private_key.clone(),
        date_less_than: expires_at,
        ..Default::default()
    };

    Ok(get_signed_url(&resource_url, &options)?)
}

impl RecordingStorage for S3RecordingStorage {
    async fn presign_recording_url(&self, recording_key: &str) -> anyhow::Result<String> {
        let object_key = recording_object_key(recording_key);
        if macro_aws_config::is_local_aws() {
            self.presign_s3_url(&object_key).await
        } else {
            self.presign_get_url(&object_key)
        }
    }

    async fn presign_recording_preview_url(&self, preview_key: &str) -> anyhow::Result<String> {
        let object_key = preview_object_key(preview_key);
        if macro_aws_config::is_local_aws() {
            self.presign_s3_url(object_key).await
        } else {
            self.presign_get_url(object_key)
        }
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
mod test;
