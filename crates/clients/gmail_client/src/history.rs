use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::HistoryListResponse;

const MAX_RESULTS: usize = 500;

/// Gets one page of the changes to a user's inbox that have occurred since
/// `start_history_id`. Returns the raw Gmail response for conversion by the caller.
#[tracing::instrument(skip(client, access_token, page_token), err)]
pub(crate) async fn get_history_page(
    client: &GmailClient,
    access_token: &str,
    start_history_id: &str,
    page_token: Option<&str>,
) -> Result<HistoryListResponse, GmailApiHttpError> {
    let mut request = client
        .inner
        .get(format!("{}/users/me/history", client.base_url))
        .bearer_auth(access_token)
        .query(&[
            ("startHistoryId", start_history_id),
            ("maxResults", &MAX_RESULTS.to_string()),
        ]);
    if let Some(token) = page_token {
        request = request.query(&[("pageToken", token)]);
    }

    let response = request.send().await.map_err(GmailApiHttpError::transport)?;
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

#[cfg(test)]
mod test;
