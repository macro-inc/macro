use anyhow::Context;
use aws_sdk_s3::{self as s3};

/// Checks if a given key exists in the bucket
#[tracing::instrument(skip(client))]
pub(in crate::service::s3) async fn exists(
    client: &s3::Client,
    bucket: &str,
    key: &str,
) -> anyhow::Result<bool> {
    #[cfg(feature = "local")]
    {
        return Ok(true);
    }
    let resp = client.head_object().bucket(bucket).key(key).send().await;

    match resp {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.as_service_error().map(|e| e.is_not_found()) == Some(true) {
                return Ok(false);
            }

            Err(e).context("failed to perform head object operation")
        }
    }
}
