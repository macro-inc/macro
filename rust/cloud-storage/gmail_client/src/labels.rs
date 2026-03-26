use crate::GmailClient;
use anyhow::Context;
use models_email::email::service;
use models_email::gmail::ModifyLabelsRequest;
use models_email::gmail::error::GmailError;
use models_email::gmail::labels::GmailLabelsResponse;
use uuid::Uuid;

/// Modifies the labels for a specific message in Gmail
/// Adds and removes labels according to the provided lists
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
) -> Result<(), GmailError> {
    let url = format!(
        "{}/users/me/messages/{}/modify",
        client.base_url, provider_message_id
    );

    let http_client = client.inner.clone();

    let payload = ModifyLabelsRequest {
        add_label_ids: label_ids_to_add.to_vec(),
        remove_label_ids: label_ids_to_remove.to_vec(),
    };

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());

        return Err(match status.as_u16() {
            401 => GmailError::Unauthorized,
            403 => GmailError::Forbidden,
            404 => GmailError::NotFound(error_body),
            429 => GmailError::RateLimitExceeded,
            s if s >= 500 => GmailError::ServerError(s, error_body),
            _ => GmailError::ApiError(format!(
                "Gmail API error {} (modify message labels): {}",
                status, error_body
            )),
        });
    }

    Ok(())
}

#[tracing::instrument(skip(client, access_token), err)]
pub async fn fetch_user_labels(
    client: &GmailClient,
    access_token: &str,
    link_id: uuid::Uuid,
) -> anyhow::Result<Vec<service::label::Label>> {
    let url = format!("{}/users/me/labels", client.base_url);

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to Gmail API (fetch labels)")?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        anyhow::bail!("Gmail API error {} (fetch labels): {}", status, error_body);
    }

    let labels_response = response
        .json::<GmailLabelsResponse>()
        .await
        .context("Failed to parse JSON response from Gmail API (fetch labels)")?;

    // Convert Gmail API labels to service labels
    let service_labels = labels_response
        .to_service_labels(link_id)
        .map_err(|e| anyhow::anyhow!("Failed to convert Gmail labels to service labels: {}", e))?;

    Ok(service_labels)
}

#[tracing::instrument(skip(client, access_token), err)]
pub async fn create_label(
    client: &GmailClient,
    access_token: &str,
    link_id: Uuid,
    label_name: &str,
) -> Result<service::label::Label, GmailError> {
    let url = format!("{}/users/me/labels", client.base_url);

    let http_client = client.inner.clone();

    let request_label = models_email::gmail::labels::GmailLabel {
        id: None,
        name: label_name.to_string(),
        message_list_visibility: Some("show".to_string()),
        label_list_visibility: Some("labelShow".to_string()),
        type_: Some("user".to_string()),
        color: None,
    };

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&request_label)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let response = match response.error_for_status() {
        Ok(r) => r,
        Err(e) => {
            if e.status() == Some(reqwest::StatusCode::CONFLICT) {
                return Err(GmailError::Conflict("Label already exists".to_string()));
            }
            return Err(GmailError::ApiError(e.to_string()));
        }
    };

    let created_label = response
        .json::<models_email::gmail::labels::GmailLabel>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    // Convert Gmail API label to service label
    let service_label = created_label
        .to_service_label(link_id)
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok(service_label)
}

#[tracing::instrument(
    skip(client, access_token),
    fields(label_id = %label_id),
    err
)]
pub async fn delete_gmail_label(
    client: &GmailClient,
    access_token: &str,
    label_id: &str,
) -> Result<(), GmailError> {
    let url = format!("{}/users/me/labels/{}", client.base_url, label_id);

    let http_client = client.inner.clone();

    let response = http_client
        .delete(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    match response.status() {
        status if status.is_success() => Ok(()),
        reqwest::StatusCode::NOT_FOUND => {
            tracing::warn!(
                label_id = %label_id,
                "Label not found in Gmail when attempting to delete"
            );
            Err(GmailError::NotFound(format!(
                "Label {} not found",
                label_id
            )))
        }
        status => {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());

            Err(GmailError::ApiError(format!(
                "Failed to delete label. Status: {}. Error: {}",
                status, error_body
            )))
        }
    }
}
