use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::GmailUserProfile;

#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_profile(
    client: &GmailClient,
    access_token: &str,
) -> Result<GmailUserProfile, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/users/me/profile", client.base_url))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

#[cfg(test)]
mod test;
