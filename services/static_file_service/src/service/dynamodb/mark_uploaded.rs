use anyhow::{Context, Result};
use aws_sdk_dynamodb::{
    Client, types::AttributeAction, types::AttributeValue, types::AttributeValueUpdate,
};

pub async fn mark_uploaded(client: &Client, table: &str, id: &str) -> Result<()> {
    let update = AttributeValueUpdate::builder()
        .action(AttributeAction::Put)
        .value(AttributeValue::Bool(true))
        .build();

    client
        .update_item()
        .table_name(table)
        .key("file_id", AttributeValue::S(id.to_owned()))
        .attribute_updates("is_uploaded", update)
        .send()
        .await
        .context("failed to mark file as uploaded")?;

    Ok(())
}
