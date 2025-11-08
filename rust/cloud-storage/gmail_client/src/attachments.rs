use crate::GmailClient;
use anyhow::{Context, anyhow};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE;
use models_email::gmail::AttachmentGetResponse;

#[tracing::instrument(skip(client, access_token))]
pub async fn get_attachment_data(
    client: &GmailClient,
    access_token: &str,
    message_id: &str,
    attachment_id: &str,
) -> anyhow::Result<Vec<u8>> {
    let url = format!(
        "{}/users/me/messages/{}/attachments/{}",
        client.base_url, message_id, attachment_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to Gmail API (get attachment)")?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("Failed to get response body")?;
    if !status.is_success() {
        return Err(anyhow::anyhow!(
            "Gmail API returned an error status: {} (get attachment): {}",
            status,
            body_text
        ));
    }

    let attachment_response: AttachmentGetResponse = serde_json::from_str(&body_text)
        .context("Failed to parse JSON response from Gmail API (get attachment)")?;

    let base64_data = attachment_response
        .data
        .ok_or_else(|| anyhow!("Gmail API response for attachment did not contain data field"))?;

    let decoded_bytes = match URL_SAFE.decode(base64_data) {
        Ok(decoded_bytes) => decoded_bytes,
        Err(e) => {
            return Err(anyhow!(
                "Failed to decode base64 body data: {}",
                e.to_string()
            ));
        }
    };

    Ok(decoded_bytes)
}
