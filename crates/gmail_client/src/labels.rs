use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::ModifyLabelsRequest;
use models_email::gmail::labels::{GmailLabel, GmailLabelsResponse};

/// Modifies the labels for a specific message in Gmail.
#[tracing::instrument(
    skip(client, access_token),
    fields(provider_message_id = %provider_message_id),
    err
)]
pub async fn modify_message_labels(
    client: &GmailClient,
    access_token: &str,
    provider_message_id: &str,
    label_ids_to_add: &[String],
    label_ids_to_remove: &[String],
) -> Result<(), GmailApiHttpError> {
    let url = format!(
        "{}/users/me/messages/{}/modify",
        client.base_url, provider_message_id
    );
    let payload = ModifyLabelsRequest {
        add_label_ids: label_ids_to_add.to_vec(),
        remove_label_ids: label_ids_to_remove.to_vec(),
    };
    let response = client
        .inner
        .post(url)
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    Ok(())
}

/// Fetches the user's raw Gmail labels.
#[tracing::instrument(skip(client, access_token), err)]
pub async fn fetch_user_labels(
    client: &GmailClient,
    access_token: &str,
) -> Result<Vec<GmailLabel>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/users/me/labels", client.base_url))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let response = decode_json_response::<GmailLabelsResponse>(response).await?;
    Ok(response.labels)
}

/// Creates a Gmail label from the supplied wire request.
#[tracing::instrument(skip(client, access_token), err)]
pub async fn create_label(
    client: &GmailClient,
    access_token: &str,
    request: &GmailLabel,
) -> Result<GmailLabel, GmailApiHttpError> {
    let response = client
        .inner
        .post(format!("{}/users/me/labels", client.base_url))
        .bearer_auth(access_token)
        .json(request)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Deletes a Gmail label by provider ID.
#[tracing::instrument(skip(client, access_token), fields(label_id = %label_id), err)]
pub async fn delete_gmail_label(
    client: &GmailClient,
    access_token: &str,
    label_id: &str,
) -> Result<(), GmailApiHttpError> {
    let response = client
        .inner
        .delete(format!("{}/users/me/labels/{label_id}", client.base_url))
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
