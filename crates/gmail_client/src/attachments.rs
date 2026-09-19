use base64::Engine;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use models_email::gmail::AttachmentGetResponse;

use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};

#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_attachment_data(
    client: &GmailClient,
    access_token: &str,
    message_id: &str,
    attachment_id: &str,
) -> Result<Vec<u8>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!(
            "{}/users/me/messages/{message_id}/attachments/{attachment_id}",
            client.base_url
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let attachment: AttachmentGetResponse = decode_json_response(response).await?;
    let data = attachment.data.ok_or_else(|| {
        GmailApiHttpError::InvalidResponse(
            "attachment response did not contain a data field".to_string(),
        )
    })?;

    URL_SAFE
        .decode(&data)
        .or_else(|_| URL_SAFE_NO_PAD.decode(&data))
        .map_err(|error| {
            GmailApiHttpError::InvalidResponse(format!(
                "attachment data was not valid base64url: {error}"
            ))
        })
}

#[cfg(test)]
mod test;
