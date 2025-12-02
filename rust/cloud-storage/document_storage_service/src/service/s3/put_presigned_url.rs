use anyhow::Context;
use aws_sdk_s3 as s3;
use base64::Engine;
use std::time::Duration;
use tracing::instrument;

use s3::presigning::PresigningConfig;

use model::document::ContentType;

#[instrument(skip(client))]
pub(in crate::service::s3) async fn put_presigned_url(
    client: &s3::Client,
    bucket: &str,
    key: &str,
    sha: &str,
    content_type: ContentType,
) -> anyhow::Result<String> {
    if cfg!(feature = "local") {
        return Ok("fake".to_string());
    }
    // Allows the app 2 minutes to grab the document
    let expiry_duration = Duration::from_secs(2 * 60);

    // Convert the hex SHA256 hash to binary
    let payload_sha256_bytes = hex::decode(sha).context("able to decode hex sha")?;
    // Encode the binary hash into base64
    let base64_encoded_sha = base64::engine::general_purpose::STANDARD.encode(payload_sha256_bytes);

    tracing::trace!("sha info {sha} {base64_encoded_sha}");

    // Generate the presigned URL.
    let presigned_url = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .content_type(content_type.mime_type())
        .checksum_sha256(base64_encoded_sha)
        .presigned(PresigningConfig::expires_in(expiry_duration)?)
        .await?;

    Ok(presigned_url.uri().to_string())
}
