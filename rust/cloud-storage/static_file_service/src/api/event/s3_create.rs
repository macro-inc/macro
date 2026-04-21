use super::message::*;
use crate::service::dynamodb::client::DynamodbClient;
use anyhow::{Context, Result};

#[tracing::instrument(skip(metadata_client))]
pub async fn handle_s3_create(event: S3EventRecord, metadata_client: DynamodbClient) -> Result<()> {
    metadata_client
        .mark_uploaded(event.s3.object.key.as_str())
        .await
        .context("could not not mark file uploaded")
}
