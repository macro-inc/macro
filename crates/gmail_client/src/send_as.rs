use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::ListSendAsResponse;

#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_send_as(
    client: &GmailClient,
    access_token: &str,
) -> Result<ListSendAsResponse, GmailApiHttpError> {
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

    decode_json_response(response).await
}
