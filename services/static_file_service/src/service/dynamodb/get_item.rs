use anyhow::{self, Context, Result};
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;
use std::collections::HashMap;

pub async fn get_metadata_by_id(
    client: &Client,
    table: &str,
    id: &str,
) -> Result<Option<HashMap<String, AttributeValue>>> {
    Ok(client
        .get_item()
        .table_name(table)
        .key("file_id", AttributeValue::S(id.to_owned()))
        .send()
        .await
        .context("failed to get item from metadata table")?
        .item()
        .map(|v| v.to_owned()))
}
