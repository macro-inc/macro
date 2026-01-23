use super::delete_item::delete_item;
use super::get_item;
use super::mark_uploaded;
use super::model::DeleteError;
use super::model::MetadataObject;
use super::put_item;
use anyhow::{Context, Result, format_err};
use aws_config::Region;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;
use serde_dynamo::{Item, from_item, to_item};
use std::collections::HashMap;

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

    #[tracing::instrument(skip(self), fields(count = file_ids.len()), err)]
    pub async fn bulk_get_metadata(
        &self,
        file_ids: &[String],
    ) -> Result<HashMap<String, MetadataObject>> {
        if file_ids.is_empty() {
            return Ok(HashMap::new());
        }

        // DynamoDB batch_get_item has a limit of 100 items
        let chunk_size = 100;
        let mut all_results = HashMap::new();

        for chunk in file_ids.chunks(chunk_size) {
            let mut keys = Vec::new();
            for file_id in chunk {
                let mut key = HashMap::new();
                key.insert("file_id".to_string(), AttributeValue::S(file_id.clone()));
                keys.push(key);
            }

            let request_items = {
                let mut request_items = HashMap::new();
                request_items.insert(
                    self.table.clone(),
                    aws_sdk_dynamodb::types::KeysAndAttributes::builder()
                        .set_keys(Some(keys))
                        .build()
                        .context("failed to build KeysAndAttributes")?,
                );
                request_items
            };

            let response = self
                .client
                .batch_get_item()
                .set_request_items(Some(request_items))
                .send()
                .await
                .context("failed to batch get items from metadata table")?;

            if let Some(responses) = response.responses()
                && let Some(items) = responses.get(&self.table)
            {
                for item in items {
                    let metadata: MetadataObject =
                        from_item(item.clone()).context("failed to deserialize metadata")?;
                    all_results.insert(metadata.file_id.clone(), metadata);
                }
            }
        }

        Ok(all_results)
    }

    #[tracing::instrument(skip(self), fields(count = file_ids.len()))]
    pub async fn bulk_delete_metadata(&self, file_ids: &[&str]) -> Vec<Result<(), DeleteError>> {
        if file_ids.is_empty() {
            return Vec::new();
        }

        // DynamoDB batch_write_item has a limit of 25 items per request
        const BATCH_SIZE: usize = 25;
        let mut results = Vec::with_capacity(file_ids.len());

        // Initialize results as success, will mark failures later
        for _ in 0..file_ids.len() {
            results.push(Ok(()));
        }

        for (chunk_idx, chunk) in file_ids.chunks(BATCH_SIZE).enumerate() {
            let base_idx = chunk_idx * BATCH_SIZE;

            // Build delete requests
            let mut write_requests = Vec::new();
            for file_id in chunk {
                let mut key = HashMap::new();
                key.insert(
                    "file_id".to_string(),
                    AttributeValue::S(file_id.to_string()),
                );

                let delete_request = aws_sdk_dynamodb::types::DeleteRequest::builder()
                    .set_key(Some(key))
                    .build()
                    .context("failed to build DeleteRequest");

                match delete_request {
                    Ok(del_req) => {
                        write_requests.push(
                            aws_sdk_dynamodb::types::WriteRequest::builder()
                                .delete_request(del_req)
                                .build(),
                        );
                    }
                    Err(e) => {
                        tracing::error!(file_id = file_id, error = ?e, "failed to build delete request");
                        results[base_idx + write_requests.len()] =
                            Err(DeleteError::Other(e.to_string()));
                    }
                }
            }

            if write_requests.is_empty() {
                continue;
            }

            let mut request_items = HashMap::new();
            request_items.insert(self.table.clone(), write_requests);

            // Execute batch write
            match self
                .client
                .batch_write_item()
                .set_request_items(Some(request_items.clone()))
                .send()
                .await
            {
                Ok(response) => {
                    // Handle unprocessed items
                    if let Some(unprocessed) = response.unprocessed_items()
                        && let Some(unprocessed_writes) = unprocessed.get(&self.table)
                        && !unprocessed_writes.is_empty()
                    {
                        tracing::warn!(
                            count = unprocessed_writes.len(),
                            "batch delete had unprocessed items, marking as errors"
                        );

                        // Mark unprocessed items as failures
                        for write_req in unprocessed_writes {
                            if let Some(del_req) = write_req.delete_request() {
                                let key = del_req.key();
                                if let Some(AttributeValue::S(file_id)) = key.get("file_id") {
                                    // Find the index of this file_id in the chunk
                                    if let Some(local_idx) =
                                        chunk.iter().position(|id| *id == file_id.as_str())
                                    {
                                        results[base_idx + local_idx] = Err(DeleteError::Other(
                                            "unprocessed by DynamoDB".to_string(),
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(error = ?e, "batch delete request failed");
                    // Mark all items in this chunk as failed
                    for (i, _) in chunk.iter().enumerate() {
                        results[base_idx + i] =
                            Err(DeleteError::Other(format!("batch delete failed: {}", e)));
                    }
                }
            }
        }

        results
    }
}
