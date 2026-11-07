use tracing::instrument;

#[instrument(skip(client))]
pub async fn inner_bucket_copy(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    source_key: &str,
    destination_key: &str,
) -> anyhow::Result<()> {
    client
        .copy_object()
        .bucket(bucket)
        .copy_source(format!("{}/{}", bucket, source_key))
        .key(destination_key)
        .send()
        .await?;

    Ok(())
}
