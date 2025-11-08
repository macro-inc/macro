use super::delete_item::delete_item;
use super::get_item;
use super::mark_uploaded;
use super::model::DeleteError;
use super::model::MetadataObject;
use super::put_item;
use anyhow::{Context, Result, format_err};
use aws_config::Region;
use aws_sdk_dynamodb::Client;
use serde_dynamo::{Item, from_item, to_item};

#[derive(Debug, Clone)]
pub struct DynamodbClient {
    table: String,
    client: Client,
}

impl DynamodbClient {
    pub async fn new(region: Region, table: String) -> Self {
        let client = Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(region)
                .load()
                .await,
        );
        DynamodbClient { client, table }
    }

    #[tracing::instrument(skip(self))]
    pub async fn put_metadata(&self, metadata: MetadataObject) -> Result<()> {
        let item: Item = to_item(metadata).context("failed to convert metadata object")?;
        put_item::put_item(&self.client, &self.table, item).await?;
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_metadata(&self, id: &str) -> Result<Option<MetadataObject>> {
        let record = get_item::get_metadata_by_id(&self.client, &self.table, id).await?;
        if let Some(data) = record {
            from_item(data)
                .map_err(|e| format_err!("failed to deserialize metadata: {}", e))
                .map(Some)
        } else {
            Ok(None)
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn delete_metadata(&self, id: &str) -> Result<(), DeleteError> {
        delete_item(&self.client, &self.table, id).await
    }

    #[tracing::instrument(skip(self))]
    pub async fn update_last_accessed(&self, id: &str) -> Result<Option<()>> {
        Ok(None)
    }

    #[tracing::instrument(skip(self))]
    pub async fn mark_uploaded(&self, id: &str) -> Result<()> {
        mark_uploaded::mark_uploaded(&self.client, &self.table, id).await
    }
}
