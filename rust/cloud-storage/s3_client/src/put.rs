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
