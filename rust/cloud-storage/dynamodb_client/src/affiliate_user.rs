use anyhow::Context;
use aws_sdk_dynamodb::Client;
use aws_sdk_dynamodb::types::AttributeValue;

/// Affiliates a user with a given affiliate code
#[tracing::instrument(skip(client))]
pub async fn affiliate_user(
    client: &Client,
    table: &str,
    affiliate_code: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    let pk = format!("CODE#{}", affiliate_code);
    let sk = format!("REFERRED#{}", user_id);

    client
        .put_item()
        .table_name(table)
        .item("PK", AttributeValue::S(pk))
        .item("SK", AttributeValue::S(sk))
        .item(
            "CreatedAt",
            AttributeValue::N(chrono::Utc::now().timestamp().to_string()),
        )
        .send()
        .await
        .context("failed to insert affiliate referral into DynamoDB")?;

    Ok(())
}

#[tracing::instrument(skip(client))]
pub async fn insert_referral(
    client: &Client,
    table: &str,
    affiliate_code: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    let pk = format!("REFERRED#{}", user_id);
    let sk = format!("CODE#{}", affiliate_code);

    client
        .put_item()
        .table_name(table)
        .item("PK", AttributeValue::S(pk))
        .item("SK", AttributeValue::S(sk))
        .item(
            "CreatedAt",
            AttributeValue::N(chrono::Utc::now().timestamp().to_string()),
        )
        .send()
        .await
        .context("failed to insert affiliate referral into DynamoDB")?;

    Ok(())
}
