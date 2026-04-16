use super::message::*;
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::image::{DownscaleOutcome, format_from_content_type, try_downscale};
use crate::service::s3::client::S3Client;
use anyhow::{Context, Result};
use s3_key::StaticFileKey;
use std::sync::Arc;

#[tracing::instrument(err, skip(metadata_client, storage_client), fields(key = %event.s3.object.key))]
pub async fn handle_s3_create(
    event: S3EventRecord,
    metadata_client: DynamodbClient,
    storage_client: Arc<S3Client>,
) -> Result<()> {
    try_downscale_object(&event, &metadata_client, &storage_client).await?;

    metadata_client
        .mark_uploaded(event.s3.object.key.as_str())
        .await
        .context("could not mark file uploaded")
}

#[tracing::instrument(err, skip(metadata_client, storage_client), fields(key = %event.s3.object.key))]
async fn try_downscale_object(
    event: &S3EventRecord,
    metadata_client: &DynamodbClient,
    storage_client: &S3Client,
) -> Result<()> {
    let key = event.s3.object.key.as_str();

    let file_id = StaticFileKey::from_s3_key(key)
        .context("invalid static file key")?
        .file_id;

    let metadata = metadata_client
        .get_metadata(&file_id)
        .await
        .context("failed to load metadata")?;

    let Some(metadata) = metadata else {
        tracing::debug!(
            file_id,
            "no metadata for uploaded object; skipping downscale"
        );
        return Ok(());
    };

    let Some(format) = format_from_content_type(&metadata.content_type) else {
        return Ok(());
    };

    let bytes = storage_client.get_object_bytes(key).await?;

    let outcome = tokio::task::spawn_blocking(move || try_downscale(&bytes, format))
        .await
        .context("downscale task panicked")??;

    match outcome {
        DownscaleOutcome::Skipped => Ok(()),
        DownscaleOutcome::Replaced { bytes } => storage_client
            .put_object(key, bytes, &metadata.content_type)
            .await
            .context("failed to replace object with downscaled version"),
    }
}
