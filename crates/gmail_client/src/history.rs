use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::HistoryListResponse;

const MAX_RESULTS: usize = 500;

/// Gets the changes to a user's inbox that have occurred since `start_history_id`.
/// Returns the raw Gmail response for conversion by the caller.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_history(
    client: &GmailClient,
    access_token: &str,
    start_history_id: &str,
) -> Result<HistoryListResponse, GmailApiHttpError> {
    let mut history = Vec::new();
    let mut history_id = String::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut request = client
            .inner
            .get(format!("{}/users/me/history", client.base_url))
            .bearer_auth(access_token)
            .query(&[
                ("startHistoryId", start_history_id),
                ("maxResults", &MAX_RESULTS.to_string()),
            ]);
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }

        let response = request.send().await.map_err(GmailApiHttpError::transport)?;
        if !response.status().is_success() {
            return Err(unsuccessful_response(response).await);
        }

        let page: HistoryListResponse = decode_json_response(response).await?;
        if let Some(page_history) = page.history {
            history.extend(page_history);
        }
        if !page.history_id.is_empty() {
            history_id = page.history_id;
        }
        page_token = page.next_page_token;

        if page_token.is_none() {
            return Ok(HistoryListResponse {
                history: Some(history),
                next_page_token: None,
                history_id,
            });
        }
    }
}

#[cfg(test)]
mod test;
