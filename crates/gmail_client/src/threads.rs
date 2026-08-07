use std::cmp::min;

use models_email::gmail::{ListThreadsResponse, MinimalThreadResource, ThreadResource};
use serde::de::DeserializeOwned;

use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};

#[cfg(test)]
mod test;

// 500 is max allowed by gmail api
pub const LIST_THREADS_BATCH_SIZE: u32 = 500;

/// Lists thread provider ids up to the requested number, or all if none specified.
/// `label_ids` restricts the result to threads carrying all of the given Gmail
/// label ids; an empty slice applies no label filter.
#[tracing::instrument(skip(client, access_token, next_page_token), err)]
pub(crate) async fn list_threads(
    client: &GmailClient,
    access_token: &str,
    num_threads: u32,
    next_page_token: Option<&str>,
    label_ids: &[&str],
) -> Result<ListThreadsResponse, GmailApiHttpError> {
    if num_threads == 0 {
        return Ok(ListThreadsResponse {
            threads: Some(Vec::new()),
            next_page_token: None,
        });
    }

    let batch_size = min(num_threads, LIST_THREADS_BATCH_SIZE);
    let url = format!("{}/users/me/threads", client.base_url);
    let mut query_params = vec![("maxResults", batch_size.to_string())];

    if let Some(token) = next_page_token {
        query_params.push(("pageToken", token.to_string()));
    }

    for label_id in label_ids {
        query_params.push(("labelIds", label_id.to_string()));
    }

    let response = client
        .inner
        .get(url)
        .bearer_auth(access_token)
        .query(&query_params)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Fetches a thread from the Gmail API with the given format and deserializes the response.
async fn fetch_thread<T: DeserializeOwned>(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
    format: &str,
) -> Result<T, GmailApiHttpError> {
    let url = format!("{}/users/me/threads/{thread_id}", client.base_url);
    let response = client
        .inner
        .get(url)
        .bearer_auth(access_token)
        .query(&[("format", format)])
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Fetches a single email thread with full message content from the Gmail API.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_thread(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
) -> Result<ThreadResource, GmailApiHttpError> {
    fetch_thread(client, access_token, thread_id, "full").await
}

/// Gets all message IDs for a specific thread using the minimal format
/// to reduce data transfer and processing time.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_message_ids_for_thread(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
) -> Result<Vec<String>, GmailApiHttpError> {
    let thread_resource: MinimalThreadResource =
        fetch_thread(client, access_token, thread_id, "minimal").await?;

    Ok(thread_resource
        .messages
        .into_iter()
        .map(|message| message.id)
        .collect())
}
