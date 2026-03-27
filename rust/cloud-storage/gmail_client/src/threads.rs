use crate::{GmailClient, sanitize_error_body};
use anyhow::Context;
use models_email::email::service::thread::{ThreadList, ThreadSummary};
use models_email::gmail::{ListThreadsResponse, MinimalThreadResource, ThreadResource};
use serde::de::DeserializeOwned;
use std::cmp::min;

// 500 is max allowed by gmail api
pub const LIST_THREADS_BATCH_SIZE: u32 = 500;

/// lists thread provider ids up to the requested number, or all if none specified
#[tracing::instrument(skip(client, access_token, next_page_token), err)]
pub(crate) async fn list_threads(
    client: &GmailClient,
    access_token: &str,
    num_threads: u32,
    next_page_token: Option<&str>,
) -> anyhow::Result<ThreadList> {
    if num_threads == 0 {
        return Ok(ThreadList {
            threads: Vec::new(),
            next_page_token: None,
        });
    }

    // The Gmail API's `maxResults` parameter is capped at 500.
    let batch_size = min(num_threads, LIST_THREADS_BATCH_SIZE);

    let http_client = client.inner.clone();
    let url = format!("{}/users/me/threads", client.base_url);

    let mut query_params = vec![("maxResults", batch_size.to_string())];

    // If a page token is provided, add it to the list of parameters.
    if let Some(token) = next_page_token {
        query_params.push(("pageToken", token.to_string()));
    }

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .query(&query_params) // Pass the dynamically built query params
        .send()
        .await
        .context("Failed to send request to Gmail API (list threads)")?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        let sanitized = sanitize_error_body(&error_body);
        anyhow::bail!("Gmail API error {} (list threads): {}", status, sanitized);
    }

    let gmail_response = response
        .json::<ListThreadsResponse>()
        .await
        .context("Failed to parse JSON response from Gmail API (list threads)")?;

    let thread_summaries = gmail_response
        .threads
        .unwrap_or_default()
        .into_iter()
        .map(|api_thread| ThreadSummary {
            provider_id: api_thread.id,
        })
        .collect();

    let result = ThreadList {
        threads: thread_summaries,
        next_page_token: gmail_response.next_page_token,
    };

    Ok(result)
}

/// Fetches a thread from the Gmail API with the given format and deserializes the response.
async fn fetch_thread<T: DeserializeOwned>(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
    format: &str,
) -> anyhow::Result<T> {
    let url = format!(
        "{}/users/me/threads/{}?format={}",
        client.base_url, thread_id, format
    );

    let response = client
        .inner
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context(format!(
            "Failed to send request to Gmail API for thread {}",
            thread_id
        ))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        let sanitized = sanitize_error_body(&error_body);
        anyhow::bail!(
            "Gmail API error {} (get thread, format={}) for thread_id {}: {}",
            status,
            format,
            thread_id,
            sanitized
        );
    }

    response.json::<T>().await.context(format!(
        "Failed to parse JSON response from Gmail API for thread {}",
        thread_id
    ))
}

/// Fetches a single email thread with full message content from the Gmail API.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_thread(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
) -> anyhow::Result<ThreadResource> {
    fetch_thread(client, access_token, thread_id, "full").await
}

/// Gets all message IDs for a specific thread using the minimal format
/// to reduce data transfer and processing time
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_message_ids_for_thread(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
) -> anyhow::Result<Vec<String>> {
    let thread_resource: MinimalThreadResource =
        fetch_thread(client, access_token, thread_id, "minimal").await?;

    let message_ids = thread_resource
        .messages
        .iter()
        .map(|message| message.id.clone())
        .collect();

    Ok(message_ids)
}
