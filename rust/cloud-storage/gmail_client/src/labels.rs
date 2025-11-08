use crate::GmailClient;
use anyhow::Context;
use futures::{StreamExt, stream};
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
    level = "debug"
)]
pub async fn modify_message_labels(
    client: &GmailClient,
    access_token: &str,
    provider_message_id: &str,
    label_ids_to_add: &[String],
    label_ids_to_remove: &[String],
) -> anyhow::Result<()> {
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
        .context("Failed to send request to Gmail API (modify message labels)")?;

    response
        .error_for_status()
        .context("Gmail API returned an error status (modify message labels)")?;

    Ok(())
}

#[tracing::instrument(skip_all, fields(message_count = db_provider_id_tuples.len()))]
pub async fn batch_modify_labels(
    client: &GmailClient,
    gmail_access_token: &str,
    db_provider_id_tuples: Vec<(Uuid, String)>,
    labels_to_add: Vec<String>,
    labels_to_remove: Vec<String>,
) -> (Vec<Uuid>, Vec<Uuid>) {
    let label_tasks = db_provider_id_tuples
        .clone()
        .into_iter()
        .map(move |message| {
            let client = client.clone();
            let gmail_access_token = gmail_access_token.to_string();
            let labels_to_add = labels_to_add.clone();
            let labels_to_remove = labels_to_remove.clone();

            async move {
                let db_id = message.0;
                let provider_id = message.1;
                let labels_to_add = labels_to_add;
                let labels_to_remove = labels_to_remove;

                // Update in Gmail - remove the label
                let gmail_result = client
                    .modify_message_labels(
                        &gmail_access_token,
                        &provider_id,
                        &labels_to_add,
                        &labels_to_remove,
                    )
                    .await;

                if let Err(e) = gmail_result {
                    tracing::error!(
                        error = ?e,
                        message_id = %db_id,
                        provider_id = %provider_id,
                        "Failed to remove label in Gmail"
                    );
                    return (db_id, Err(e));
                }

                (db_id, Ok(()))
            }
        });

    // Process tasks with limited concurrency
    const MAX_CONCURRENT: usize = 20;
    let results = stream::iter(label_tasks)
        .buffer_unordered(MAX_CONCURRENT)
        .collect::<Vec<_>>()
        .await;

    // Separate successful and failed messages
    let mut successful_msg_ids = Vec::new();
    let mut failed_msg_ids = Vec::new();

    for (msg_id, result) in results {
        match result {
            Ok(_) => successful_msg_ids.push(msg_id),
            Err(_) => failed_msg_ids.push(msg_id),
        }
    }

    (successful_msg_ids, failed_msg_ids)
}

#[tracing::instrument(skip(client, access_token))]
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

    let response = response
        .error_for_status()
        .context("Gmail API returned an error status (fetch labels)")?;

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

#[tracing::instrument(skip(client, access_token))]
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
    level = "info"
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
