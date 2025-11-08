use std::borrow::Cow;

use anyhow::{Context, Result};
use aws_sdk_dynamodb::Client;
use lambda_http::tracing::{self};

use crate::{
    config::{WEBSOCKET_CONNECTION_EXPIRATION_MINUTES, WEBSOCKET_CONNECTION_TABLE_NAME},
    model::websocket_connection::WebsocketConnectionSubmission,
};

#[tracing::instrument(skip(dynamodb_client))]
pub async fn add_connection(
    dynamodb_client: &Client,
    connection_id: &str,
    user_id: Option<&str>,
    email: Option<&str>,
) -> Result<()> {
    let request_time = chrono::Utc::now();
    let expiration_minutes = *WEBSOCKET_CONNECTION_EXPIRATION_MINUTES;
    let expires_at =
        expiration_minutes.map(|minutes| request_time + chrono::Duration::minutes(minutes));

    let table_name = &*WEBSOCKET_CONNECTION_TABLE_NAME;

    let websocket_connection_submission = WebsocketConnectionSubmission {
        connection_id: Cow::Borrowed(connection_id),
        user_id: user_id.map(Cow::Borrowed),
        email: email.map(Cow::Borrowed),
        expires_at_seconds: expires_at,
    };

    let item = serde_dynamo::to_item(&websocket_connection_submission)
        .context("should be able to serialize to item")?;

    dynamodb_client
        .put_item()
        .table_name(table_name)
        .set_item(Some(item))
        .send()
        .await?;

    Ok(())
}
