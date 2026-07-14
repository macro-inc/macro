use anyhow::Context;
use aws_sdk_s3::presigning::PresigningConfig;
use base64::Engine;
use std::time::Duration;
use tracing::instrument;

#[tracing::instrument(skip(client))]
pub async fn put(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    content: &[u8],
) -> anyhow::Result<()> {
    let body = aws_sdk_s3::primitives::ByteStream::from(content.to_vec());
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .send()
        .await?;
    Ok(())
}

/// generates a presigned URL for uploading a file to a bucket
#[instrument(skip(client))]
pub async fn put_presigned_url(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    sha: &str,
    mime_type: &str,
) -> anyhow::Result<String> {
    // Allows the app 2 minutes to grab the document
    let expiry_duration = Duration::from_secs(2 * 60);

    // Convert the hex SHA256 hash to binary
    let payload_sha256_bytes = hex::decode(sha).context("able to decode hex sha")?;
    // Encode the binary hash into base64
    let base64_encoded_sha = base64::engine::general_purpose::STANDARD.encode(payload_sha256_bytes);

    // Generate the presigned URL.
    let presigned_url = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .content_type(mime_type)
        .checksum_sha256(base64_encoded_sha)
        .presigned(PresigningConfig::expires_in(expiry_duration)?)
        .await?;

    Ok(presigned_url.uri().to_string())
}
