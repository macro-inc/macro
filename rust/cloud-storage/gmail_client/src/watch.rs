use crate::GmailClient;
use crate::parse::map_watch_response_to_service;
use anyhow::Context;
use models_email::gmail::WatchRequest;
use models_email::gmail::error::GmailError;
use models_email::gmail::history::WatchResponse;

/// Registers a user for Gmail push notifications to the specified Pub/Sub topic
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn register_watch(
    client: &GmailClient,
    access_token: &str,
) -> Result<WatchResponse, GmailError> {
    let url = format!("{}/users/me/watch", client.base_url);

    let http_client = client.inner.clone();

    // Prepare the request body with the topic name
    let request_body = WatchRequest {
        topic_name: client.subscription_topic.clone(),
    };

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    // Check specifically for 401 Unauthorized
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!("Gmail API returned 401 Unauthorized - access token might be expired");
        return Err(GmailError::Unauthorized);
    }

    // Handle other error status codes
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        return Err(GmailError::ApiError(format!(
            "({}): {}",
            status, error_body
        )));
    }

    let watch_response = response
        .json::<WatchResponse>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok(map_watch_response_to_service(watch_response))
}

/// Stops push notifications for a user's Gmail inbox
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn stop_watch(client: &GmailClient, access_token: &str) -> anyhow::Result<()> {
    let url = format!("{}/users/me/stop", client.base_url);

    let http_client = client.inner.clone();

    let response = http_client
        .post(&url)
        .header("Content-Length", "0")
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to Gmail API (stop watch)")?;

    response
        .error_for_status()
        .context("Gmail API returned an error status (stop watch)")?;

    Ok(())
}
