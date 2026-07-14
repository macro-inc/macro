use anyhow::Context;

/// Checks if a given key exists in the bucket
#[tracing::instrument(skip(client))]
pub(crate) async fn exists(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
) -> anyhow::Result<bool> {
    let resp = client.head_object().bucket(bucket).key(key).send().await;

    if let Err(e) = resp {
        if e.as_service_error().map(|e| e.is_not_found()) == Some(true) {
            return Ok(false);
        }

        return Err(e).context("failed to perform head object operation");
    }

    Ok(true)
}
