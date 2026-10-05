//! Gmail Settings.sendAs API client methods.

use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::send_as::{ListSendAsResponse, SendAsResource};

/// Lists all send-as aliases for the authenticated user.
///
/// Returns the complete list of send-as configurations, including the primary
/// address. The primary address cannot be deleted but is always present.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_send_as(
    client: &GmailClient,
    access_token: &str,
) -> Result<Vec<SendAsResource>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/users/me/settings/sendAs", client.base_url))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let response = decode_json_response::<ListSendAsResponse>(response).await?;
    Ok(response.send_as)
}

/// Gets a single send-as alias configuration.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_send_as(
    client: &GmailClient,
    access_token: &str,
    send_as_email: &str,
) -> Result<Option<SendAsResource>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!(
            "{}/users/me/settings/sendAs/{send_as_email}",
            client.base_url
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await.map(Some)
}

#[cfg(test)]
mod test;
