use anyhow::{Context, Result};
use serde_dynamo::Item;

pub async fn put_item(client: &aws_sdk_dynamodb::Client, table: &str, items: Item) -> Result<()> {
    client
        .put_item()
        .table_name(table)
        .set_item(Some(items.into()))
        .send()
        .await
        .context("could not put item, dynamodb")?;

    Ok(())
}

#[cfg(feature = "dynamodb_client_test")]
#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use aws_sdk_dynamodb::types::AttributeValue;
    use aws_sdk_dynamodb::{Client, types::TransactWriteItem};
    use serde_dynamo::Item;
    use std::collections::HashMap;
    use tokio;

    const TABLE_NAME: &str = "static-file-metadata-dev";

    // Helper function to create a DynamoDB client for testing
    async fn create_test_client() -> Result<Client> {
        let client = Client::new(
            &aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region("us-east-1")
                .load()
                .await,
        );
        Ok(client)
    }

    // Helper function to get the original item state
    async fn get_test_item(
        client: &Client,
        id: &str,
    ) -> Result<Option<HashMap<String, AttributeValue>>> {
        let result = client
            .get_item()
            .table_name(TABLE_NAME)
            .key("id", AttributeValue::S(id.to_string()))
            .send()
            .await
            .context("failed to get original item")?;

        Ok(result.item().cloned())
    }

    #[tokio::test]
    async fn test_put_item_with_transaction() -> Result<()> {
        let client = create_test_client().await?;
        let test_id = "test_transaction_id";

        // Store original state
        let original_item = get_test_item(&client, test_id).await?;

        // Create test item
        let mut test_items = HashMap::new();
        test_items.insert("id".to_string(), AttributeValue::S(test_id.to_string()));
        test_items.insert(
            "name".to_string(),
            AttributeValue::S("Test Transaction Item".to_string()),
        );
        test_items.insert("version".to_string(), AttributeValue::N("1".to_string()));

        // Test put_item
        put_item(&client, TABLE_NAME, Item::from(test_items.clone())).await?;

        // Verify item was inserted
        let updated_item = get_test_item(&client, test_id).await?;
        assert!(updated_item.is_some());
        assert_eq!(
            updated_item.unwrap().get("name").unwrap().as_s().unwrap(),
            "Test Transaction Item"
        );

        // Revert changes using transaction
        if let Some(original) = original_item.clone() {
            // If item existed before, restore it
            let put_request = aws_sdk_dynamodb::types::Put::builder()
                .table_name(TABLE_NAME)
                .set_item(Some(original))
                .build()?;

            let revert_transaction = TransactWriteItem::builder().put(put_request).build();

            client
                .transact_write_items()
                .transact_items(revert_transaction)
                .send()
                .await
                .context("failed to revert changes")?;
        } else {
            // If item didn't exist before, delete it
            let delete_request = aws_sdk_dynamodb::types::Delete::builder()
                .table_name(TABLE_NAME)
                .key("id", AttributeValue::S(test_id.to_string()))
                .build()?;

            let revert_transaction = TransactWriteItem::builder().delete(delete_request).build();

            client
                .transact_write_items()
                .transact_items(revert_transaction)
                .send()
                .await
                .context("failed to revert changes")?;
        }

        // Verify revert was successful
        let final_state = get_test_item(&client, test_id).await?;
        assert_eq!(final_state, original_item);

        Ok(())
    }

    #[tokio::test]
    async fn test_put_item_idempotency() -> Result<()> {
        let client = create_test_client().await?;
        let test_id = "test_idempotency_id";

        // Store original state
        let original_item = get_test_item(&client, test_id).await?;

        // Create test item
        let mut test_items = HashMap::new();
        test_items.insert("id".to_string(), AttributeValue::S(test_id.to_string()));
        test_items.insert(
            "name".to_string(),
            AttributeValue::S("Test Idempotency".to_string()),
        );
        test_items.insert("version".to_string(), AttributeValue::N("1".to_string()));

        // Put the same item twice
        put_item(&client, TABLE_NAME, Item::from(test_items.clone())).await?;
        put_item(&client, TABLE_NAME, Item::from(test_items.clone())).await?;

        // Verify item state
        let updated_item = get_test_item(&client, test_id).await?;
        assert!(updated_item.is_some());
        assert_eq!(
            updated_item.unwrap().get("name").unwrap().as_s().unwrap(),
            "Test Idempotency"
        );

        // Revert changes
        if let Some(original) = original_item {
            let put_request = aws_sdk_dynamodb::types::Put::builder()
                .table_name(TABLE_NAME)
                .set_item(Some(original))
                .build()?;

            let revert_transaction = TransactWriteItem::builder().put(put_request).build();

            client
                .transact_write_items()
                .transact_items(revert_transaction)
                .send()
                .await
                .context("failed to revert changes")?;
        } else {
            let delete_request = aws_sdk_dynamodb::types::Delete::builder()
                .table_name(TABLE_NAME)
                .key("id", AttributeValue::S(test_id.to_string()))
                .build()?;

            let revert_transaction = TransactWriteItem::builder().delete(delete_request).build();

            client
                .transact_write_items()
                .transact_items(revert_transaction)
                .send()
                .await
                .context("failed to revert changes")?;
        }
        let no_item = get_test_item(&client, test_id).await?;
        assert!(no_item.is_none());
        Ok(())
    }
}
