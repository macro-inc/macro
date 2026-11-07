use anyhow::Context;
use aws_sdk_s3 as s3;
use aws_sdk_s3::Client;
use aws_sdk_s3::presigning::{PresignedRequest, PresigningConfig};
use std::time::Duration;

/// Gets a given item from the bucket
#[tracing::instrument(skip(client))]
pub async fn get(client: &s3::Client, bucket: &str, key: &str) -> anyhow::Result<Vec<u8>> {
    let resp = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .context(format!("could not get item {key} from bucket {bucket}"))?;

    let body = resp
        .body
        .collect()
        .await
        .context("could not collect body")?;
    Ok(body.into_bytes().to_vec())
}

/// Generate a URL for a presigned GET request.
pub async fn get_presigned_url(
    client: &Client,
    bucket: &str,
    object: &str,
    duration_seconds: u64,
) -> anyhow::Result<PresignedRequest> {
    let expires_in = Duration::from_secs(duration_seconds);
    let presigned_request = client
        .get_object()
        .bucket(bucket)
        .key(object)
        .presigned(PresigningConfig::expires_in(expires_in)?)
        .await?;

    Ok(presigned_request)
}
