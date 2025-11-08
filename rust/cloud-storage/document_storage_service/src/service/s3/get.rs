use anyhow::Context;
use aws_sdk_s3 as s3;

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
