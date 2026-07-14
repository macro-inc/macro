use super::message::*;
use crate::service::dynamodb::client::DynamodbClient;
use anyhow::{Context, Result};

#[tracing::instrument(skip(metadata_client))]
pub async fn handle_s3_create(event: S3EventRecord, metadata_client: DynamodbClient) -> Result<()> {
    // Skip CloudFront image optimizer keys (e.g. "file/{uuid}/format=webp,width=300")
    if event.s3.object.key.matches('/').count() > 1 {
        return Ok(());
    }

    let key = s3_key::StaticFileKey::from_s3_key(&event.s3.object.key)
        .inspect_err(
            |err| tracing::error!(error=?err, key=%event.s3.object.key, "unexpected s3 key format"),
        )
        .context("failed to parse file_id from s3 key")?;
    let file_id = key.file_id();
    metadata_client
        .mark_uploaded(file_id)
        .await
        .context("could not mark file uploaded")
}
