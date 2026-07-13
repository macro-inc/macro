use anyhow::{Context, Result};
use aws_sdk_s3::Client;

/// Downloads an object from S3, returning its bytes and content-type.
pub async fn fetch(client: &Client, bucket: &str, key: &str) -> Result<(Vec<u8>, Option<String>)> {
    let output = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .context("failed to get object from S3")?;

    let content_type = output.content_type().map(String::from);
    let bytes = output
        .body
        .collect()
        .await
        .context("failed to read S3 body")?
        .into_bytes()
        .to_vec();

    Ok((bytes, content_type))
}

/// Uploads an object to S3 with the given content-type and cache-control.
pub async fn store(
    client: &Client,
    bucket: &str,
    key: &str,
    body: Vec<u8>,
    content_type: &str,
    cache_ttl: &str,
) -> Result<()> {
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body.into())
        .content_type(content_type)
        .cache_control(format!("public, max-age={cache_ttl}"))
        .send()
        .await
        .context("failed to store object in S3")?;
    Ok(())
}
