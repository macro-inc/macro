use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::WatchRequest;
use models_email::gmail::history::WatchResponse;

/// Registers a user for Gmail push notifications.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn register_watch(
    client: &GmailClient,
    access_token: &str,
) -> Result<WatchResponse, GmailApiHttpError> {
    let request = WatchRequest {
        topic_name: client.subscription_topic.clone(),
    };
    let response = client
        .inner
        .post(format!("{}/users/me/watch", client.base_url))
        .bearer_auth(access_token)
        .json(&request)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Stops push notifications for a user's Gmail inbox.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn stop_watch(
    client: &GmailClient,
    access_token: &str,
) -> Result<(), GmailApiHttpError> {
    let response = client
        .inner
        .post(format!("{}/users/me/stop", client.base_url))
        .header("Content-Length", "0")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    Ok(())
}

#[cfg(test)]
mod test;
