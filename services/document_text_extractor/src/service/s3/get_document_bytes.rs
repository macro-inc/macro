use anyhow::Result;
use aws_sdk_s3 as s3;
use lambda_runtime::tracing;

#[cfg_attr(test, allow(dead_code))]
#[tracing::instrument(skip(client))]
pub async fn get_document_bytes(client: &s3::Client, bucket: &str, key: &str) -> Result<Vec<u8>> {
    let resp = client.get_object().bucket(bucket).key(key).send().await?;

    let body = resp.body.collect().await?;
    Ok(body.into_bytes().to_vec())
}
