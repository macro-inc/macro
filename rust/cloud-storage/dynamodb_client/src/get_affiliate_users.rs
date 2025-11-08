use std::collections::HashMap;

use anyhow::Context;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;
use model::affiliate::AffiliateUser;

/// Gets the users that have been affiliated with the give affiliate code
#[tracing::instrument(skip(client))]
pub async fn get_affiliate_users(
    client: &Client,
    table: &str,
    affiliate_code: &str,
) -> anyhow::Result<Vec<AffiliateUser>> {
    let mut users: Vec<AffiliateUser> = Vec::new();
    let mut last_evaluated_key: Option<HashMap<String, AttributeValue>> = None;

    // Loop until all pages are processed
    loop {
        // Build the query with pagination support
        let mut query = client
            .query()
            .table_name(table)
            .key_condition_expression("PK = :pk AND begins_with(SK, :sk_prefix)")
            .expression_attribute_values(
                ":pk",
                AttributeValue::S(format!("CODE#{}", affiliate_code)),
            )
            .expression_attribute_values(":sk_prefix", AttributeValue::S("REFERRED#".to_string()));

        // Add exclusive start key if we have one from a previous query
        query = query.set_exclusive_start_key(last_evaluated_key);

        // Execute the query
        let query_output = query
            .send()
            .await
            .context("Failed to query DynamoDB for affiliate users")?;

        // Process the current page of results
        if let Some(items) = &query_output.items {
            for item in items {
                let email = if let Some(AttributeValue::S(sk)) = item.get("SK") {
                    sk.strip_prefix("REFERRED#").unwrap().to_string()
                } else {
                    return Err(anyhow::anyhow!("Invalid SK value in DynamoDB response"));
                };

                let created_at = if let Some(AttributeValue::N(created_at)) = item.get("CreatedAt")
                {
                    created_at.parse::<i64>().unwrap()
                } else {
                    return Err(anyhow::anyhow!(
                        "Invalid CreatedAt value in DynamoDB response"
                    ));
                };

                users.push(AffiliateUser { email, created_at });
            }
        }

        // Check if there are more results to fetch
        last_evaluated_key = query_output.last_evaluated_key;

        // Exit the loop if no more results
        if last_evaluated_key.is_none() {
            break;
        }
    }

    Ok(users)
}

#[tracing::instrument(skip(client))]
pub async fn is_user_already_referred(
    client: &Client,
    table: &str,
    user_email: &str,
) -> anyhow::Result<bool> {
    let query_output = client
        .query()
        .table_name(table)
        .key_condition_expression("PK = :pk")
        .expression_attribute_values(":pk", AttributeValue::S(format!("REFERRED#{}", user_email)))
        .send()
        .await
        .context("failed to query DynamoDB for affiliate users")?;

    if let Some(items) = query_output.items
        && !items.is_empty()
    {
        return Ok(true);
    }

    Ok(false)
}

/// Gets the user who referred you given your user email
#[tracing::instrument(skip(client))]
pub async fn get_user_referred(
    client: &Client,
    table: &str,
    user_email: &str,
) -> anyhow::Result<Option<AffiliateUser>> {
    let query_output = client
        .query()
        .table_name(table)
        .key_condition_expression("PK = :pk")
        .expression_attribute_values(":pk", AttributeValue::S(format!("REFERRED#{}", user_email)))
        .send()
        .await
        .context("failed to query DynamoDB for affiliate users")?;

    if let Some(items) = query_output.items {
        // this code does not actually check beyond the first vec element
        // TODO verify this behaviour
        if let Some(item) = items.into_iter().next() {
            let email = if let Some(AttributeValue::S(sk)) = item.get("SK") {
                sk.strip_prefix("CODE#").unwrap().to_string()
            } else {
                return Err(anyhow::anyhow!("Invalid SK value in DynamoDB response"));
            };

            let created_at = if let Some(AttributeValue::N(created_at)) = item.get("CreatedAt") {
                created_at.parse::<i64>().unwrap()
            } else {
                return Err(anyhow::anyhow!(
                    "Invalid CreatedAt value in DynamoDB response"
                ));
            };

            return Ok(Some(AffiliateUser { email, created_at }));
        }
    }

    Ok(None)
}
