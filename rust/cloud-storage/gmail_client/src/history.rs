use crate::GmailClient;
use anyhow::Context;
use models_email::gmail::{HistoryListResponse, UserProfileResponse};

const MAX_RESULTS: usize = 500;

/// Gets the changes to a user's inbox that have occurred since start_history_id.
/// Returns raw HistoryListResponse - callers should map to InboxChanges using convert module.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_history(
    client: &GmailClient,
    access_token: &str,
    start_history_id: &str,
) -> anyhow::Result<HistoryListResponse> {
    let url = format!(
        "{}/users/me/history?startHistoryId={}&maxResults={}",
        client.base_url, start_history_id, MAX_RESULTS
    );

    let http_client = client.inner.clone();

    let mut history_list_response = HistoryListResponse {
        history: Some(Vec::new()),
        history_id: String::new(),
        next_page_token: None,
    };

    loop {
        let mut request_url = url.clone();
        if let Some(token) = &history_list_response.next_page_token {
            request_url = format!("{}&pageToken={}", request_url, token);
        }

        let response = http_client
            .get(&request_url)
            .bearer_auth(access_token)
            .send()
            .await
            .with_context(|| {
                format!(
                    "Failed to send request to Gmail API (list history), start_history_id: {}",
                    start_history_id
                )
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            anyhow::bail!(
                "Gmail API error {} (list history) for start_history_id: {}: {}",
                status,
                start_history_id,
                error_body
            );
        }

        let page_response = response.json::<HistoryListResponse>()
            .await
            .with_context(|| format!("Failed to parse JSON response from Gmail API (list history), start_history_id: {}",
                                     start_history_id))?;

        // Accumulate history items
        if let Some(history) = page_response.history {
            if let Some(existing_history) = &mut history_list_response.history {
                existing_history.extend(history);
            } else {
                history_list_response.history = Some(history);
            }
        }

        if !page_response.history_id.is_empty() {
            history_list_response.history_id = page_response.history_id;
        }

        history_list_response.next_page_token = page_response.next_page_token;

        if history_list_response.next_page_token.is_none() {
            break;
        }
    }

    Ok(history_list_response)
}

/// returns the current history id for the user's inbox using the /profile endpoint
#[tracing::instrument(skip(client, access_token), err)]
pub async fn get_current_history_id(
    client: &GmailClient,
    access_token: &str,
) -> anyhow::Result<String> {
    let url = format!("{}/users/me/profile", client.base_url);

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to Gmail API (get profile)")?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        anyhow::bail!(
            "Gmail API error {} (get current history id): {}",
            status,
            error_body
        );
    }

    let profile_response = response
        .json::<UserProfileResponse>()
        .await
        .context("Failed to parse JSON response from Gmail API (get profile)")?;

    Ok(profile_response.history_id)
}
