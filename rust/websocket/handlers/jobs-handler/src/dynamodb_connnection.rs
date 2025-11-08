use anyhow::Result;
use aws_sdk_dynamodb::Client;
use lambda_http::tracing::{self, info};

use crate::{
    config::{get_verbose, WEBSOCKET_CONNECTION_TABLE_NAME},
    model::websocket_connection::{
        ConnectionId, WebsocketConnectionSubmission, WebsocketConnectionSubmissionTableKey,
    },
};

/// Attempts to get websocket connection information from the dynamodb websocket connection table
#[tracing::instrument(skip(dynamodb_client))]
pub async fn get_connection<'a>(
    dynamodb_client: &Client,
    connection_id: &str,
) -> Result<Option<WebsocketConnectionSubmission<'a>>> {
    let verbose = get_verbose();

    let key = serde_dynamo::to_item(&WebsocketConnectionSubmissionTableKey {
        connection_id: &ConnectionId(connection_id),
    })?;

    verbose.then(|| info!(connection_id = ?connection_id, key = ?key, "Getting connection"));

    let table_name = &*WEBSOCKET_CONNECTION_TABLE_NAME;
    let res = dynamodb_client
        .get_item()
        .table_name(table_name)
        .set_key(Some(key))
        .send()
        .await?;

    verbose.then(|| info!(connection_id = ?connection_id, "GOT RESULT"));
    let item = res.item;
    let websocket_connection = match item {
        Some(item) => serde_dynamo::from_item(item)?,
        None => return Ok(None),
    };

    verbose.then(|| info!(connection_id = ?connection_id, "SERIALIZED RESULT"));
    Ok(Some(websocket_connection))
}
