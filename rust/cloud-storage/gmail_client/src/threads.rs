use crate::GmailClient;
use crate::parse::map_thread_resources_to_service;
use anyhow::{Context, anyhow};
use models_email::email::service::thread;
use models_email::email::service::thread::ThreadList;
use models_email::gmail::error::GmailError;
use models_email::gmail::error::GmailError::{
    ApiError, BodyReadError, MultipartParse, RateLimitExceeded,
};
use models_email::gmail::{ListThreadsResponse, MinimalThreadResource, ThreadResource};
use reqwest::header::HeaderValue;
use std::cmp::min;
use std::collections::HashMap;
use std::thread::sleep;
use std::time::Duration;
use uuid::Uuid;

// 500 is max allowed by gmail api
pub const LIST_THREADS_BATCH_SIZE: u32 = 500;
pub const DEFAULT_BATCH_SIZE: usize = 25;
const MAX_RETRY_ATTEMPTS: usize = 5;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;

/// lists thread provider ids up to the requested number, or all if none specified
#[tracing::instrument(skip(client, access_token, next_page_token))]
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

    let response = response
        .error_for_status()
        .context("Gmail API returned an error status (list threads)")?;

    let gmail_response = response
        .json::<ListThreadsResponse>()
        .await
        .context("Failed to parse JSON response from Gmail API (list threads)")?;

    let thread_summaries = gmail_response
        .threads
        .unwrap_or_default()
        .into_iter()
        .map(|api_thread| thread::ThreadSummary {
            provider_id: api_thread.id,
        })
        .collect();

    let result = ThreadList {
        threads: thread_summaries,
        next_page_token: gmail_response.next_page_token,
    };

    Ok(result)
}

/// Wrapper for get_threads that retries on GmailBatchError::RateLimitExceeded,
/// reducing batch size each time with exponential backoff.
#[tracing::instrument(skip(client, access_token, thread_ids), level = "info")]
pub async fn get_threads_with_retry(
    client: &GmailClient,
    link_id: Uuid,
    access_token: &str,
    thread_ids: &[String],
    mut batch_size: usize,
) -> anyhow::Result<Vec<thread::Thread>> {
    let mut last_error: Option<GmailError> = None;
    let mut current_delay = Duration::from_millis(INITIAL_RETRY_DELAY_MS);

    for attempt in 0..MAX_RETRY_ATTEMPTS {
        // Call the actual get_threads function
        match get_threads(client, link_id, access_token, thread_ids, batch_size).await {
            Ok(results) => {
                return Ok(results);
            }
            Err(e) => {
                match e {
                    RateLimitExceeded => {
                        last_error = Some(RateLimitExceeded); // Store the error type
                        if attempt == MAX_RETRY_ATTEMPTS - 1 {
                            // Return the specific error wrapped in anyhow with additional context
                            return Err(anyhow!(RateLimitExceeded).context(format!(
                                "link_id: {}, thread_ids: {:?}",
                                link_id, thread_ids
                            )));
                        }

                        // Reduce batch size for next attempt
                        batch_size = (batch_size as f64 * 0.8).floor().max(1.0) as usize;
                        tracing::info!(
                            attempt = attempt + 1,
                            next_batch_size = batch_size,
                            delay_ms = current_delay.as_millis(),
                            link_id = %link_id,
                            thread_ids = ?thread_ids,
                            "Rate limit hit. Reducing batch size and retrying after delay."
                        );

                        // Wait before retrying
                        sleep(current_delay);
                        current_delay *= 2;
                    }
                    other_error => {
                        return Err(anyhow!(other_error).context(format!(
                            "link_id: {}, thread_ids: {:?}",
                            link_id, thread_ids
                        )));
                    }
                }
            }
        }
    }

    // If loop finishes, it means all attempts failed, return the last error encountered
    Err(anyhow!(last_error.unwrap_or_else(|| {
        GmailError::GenericError(format!(
            "Exited retry loop unexpectedly after {} attempts",
            MAX_RETRY_ATTEMPTS
        ))
    })))
}

/// Fetches multiple email threads in a single batch request as per https://developers.google.com/workspace/gmail/api/guides/batch.
/// The Gmail batch API accepts a multipart/mixed request containing multiple individual requests consolidated into one.
/// It returns a multipart/mixed response that needs to be parsed into individual thread responses.
#[tracing::instrument(skip(client, access_token, thread_ids),
    fields(link_id = %link_id, thread_ids = ?thread_ids, batch_size = batch_size))]
pub(crate) async fn get_threads(
    client: &GmailClient,
    link_id: Uuid,
    access_token: &str,
    thread_ids: &[String],
    batch_size: usize,
) -> Result<Vec<thread::Thread>, GmailError> {
    let mut unordered_responses = Vec::new();

    // variable batch size so we can decrease it if we get rate limited
    // see https://developers.google.com/workspace/gmail/api/guides/handle-errors#resolve_a_429_error_too_many_requests
    for id_chunk in thread_ids.chunks(batch_size) {
        // the boundary is what separates each of the requests in the batch request body. can be anything
        let boundary = "multipart_boundary_12345";

        let batch_body = build_batch_body(boundary, id_chunk, access_token);

        let content_type_value = format!("multipart/mixed; boundary={}", boundary);

        let response = client
            .inner
            .post(&client.base_batch_url)
            .header(reqwest::header::CONTENT_TYPE, content_type_value)
            .body(batch_body)
            .send()
            .await
            .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

        let response = response
            .error_for_status()
            .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

        let response_content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .cloned()
            .ok_or_else(|| GmailError::GenericError("No content-type header found".to_string()))?;

        let response_body_text = response.text().await.map_err(|_| {
            GmailError::BodyReadError(format!(
                "Failed to read batch response body for thread_ids {:?}",
                id_chunk
            ))
        })?;

        match parse_multipart_response(&response_body_text, &response_content_type) {
            Ok(mut chunk_responses) => {
                unordered_responses.append(&mut chunk_responses);
            }
            Err(e) => {
                return Err(e);
            }
        }
    }

    // the batch request can return the responses in any order. need to make sure they are in
    // the same order as the thread_ids passed into the method.
    let mut response_map: HashMap<String, ThreadResource> =
        HashMap::with_capacity(unordered_responses.len());
    for response in unordered_responses {
        response_map.insert(response.id.clone(), response);
    }

    let mut ordered_responses = Vec::with_capacity(thread_ids.len());
    for original_id in thread_ids {
        if let Some(response) = response_map.remove(original_id) {
            ordered_responses.push(response);
        } else {
            tracing::warn!(thread_id = %original_id, "Requested thread ID not found in batch response results.");
        }
    }

    let service_threads = map_thread_resources_to_service(ordered_responses, link_id)
        .await
        .map_err(|e| {
            GmailError::GenericError(format!(
                "Error while mapping thread resources to service: {}",
                e
            ))
        })?;

    Ok(service_threads)
}

/// Gets all message IDs for a specific thread using the minimal format
/// to reduce data transfer and processing time
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn get_message_ids_for_thread(
    client: &GmailClient,
    access_token: &str,
    thread_id: &str,
) -> anyhow::Result<Vec<String>> {
    let request_url = format!(
        "{}/users/me/threads/{}?format=minimal",
        client.base_url, thread_id
    );

    let response = client
        .inner
        .get(&request_url)
        .bearer_auth(access_token)
        .send()
        .await
        .context(format!(
            "Failed to send request to Gmail API for thread {}",
            thread_id
        ))?;

    let response = response.error_for_status().context(format!(
        "Gmail API returned an error status for thread {}",
        thread_id
    ))?;

    let thread_resource = response
        .json::<MinimalThreadResource>()
        .await
        .context(format!(
            "Failed to parse JSON response from Gmail API for thread {}",
            thread_id
        ))?;

    // Extract message IDs from the response
    let message_ids = thread_resource
        .messages
        .iter()
        .map(|message| message.id.clone())
        .collect();

    Ok(message_ids)
}

/// build the batch request object - one sub-request for each thread_id
fn build_batch_body(boundary: &str, thread_ids: &[String], access_token: &str) -> String {
    let mut batch_body = String::new();
    let content_id_prefix = "content_id_";

    for thread_id in thread_ids {
        let content_id = format!("<{}_{}>", content_id_prefix, thread_id);
        let part = format!(
            "--{boundary}\r\n\
             Content-Type: application/http\r\n\
             Content-ID: {content_id}\r\n\
             \r\n\
             GET /gmail/v1/users/me/threads/{thread_id}?format=full HTTP/1.1\r\n\
             Authorization: Bearer {access_token}\r\n\
             Accept: application/json\r\n\
             \r\n",
            boundary = boundary,
            content_id = content_id,
            thread_id = thread_id,
            access_token = access_token
        );
        batch_body.push_str(&part);
    }

    batch_body.push_str(&format!("--{}--\r\n", boundary));
    batch_body
}

/// the response from the batch request is a multipart response - parse it into separate threads
fn parse_multipart_response(
    response_body: &str,
    response_content_type: &HeaderValue,
) -> Result<Vec<ThreadResource>, GmailError> {
    // boundary is what separates each of the responses in the batch
    let boundary = response_content_type
        .to_str()
        .map_err(|e| GmailError::MultipartParse(format!("Content-Type invalid UTF-8: {}", e)))?
        .split("boundary=")
        .nth(1)
        .ok_or_else(|| {
            GmailError::MultipartParse("Could not find boundary in Content-Type".into())
        })?
        .trim_matches('"');

    let mut results = Vec::new();
    let boundary_marker = format!("--{}", boundary);

    for part in response_body.split(&boundary_marker) {
        let trimmed_part = part.trim();

        if trimmed_part.is_empty() || trimmed_part == "--" {
            continue;
        }

        if let Some(separator_index) = trimmed_part.find("{") {
            let headers_and_status = &trimmed_part[..separator_index];
            let body_json = &trimmed_part[separator_index..]; // Skip \r\n\r\n

            if let Some(status_line) = headers_and_status.lines().nth(3) {
                if status_line.contains("HTTP/1.1 200 OK") {
                    match serde_json::from_str::<ThreadResource>(body_json) {
                        Ok(thread_response) => {
                            results.push(thread_response);
                        }
                        Err(e) => {
                            return Err(BodyReadError(e.to_string()));
                        }
                    }
                } else if status_line.contains("HTTP/1.1 429 Too Many Requests") {
                    return Err(RateLimitExceeded);
                } else {
                    return Err(ApiError(status_line.to_string()));
                }
            } else {
                return Err(MultipartParse(
                    "Could not find status line in batch response part".to_string(),
                ));
            }
        } else {
            return Err(MultipartParse(
                "Could not find header/body separator in batch response part".to_string(),
            ));
        }
    }

    Ok(results)
}
