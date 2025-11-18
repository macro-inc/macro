use crate::GmailClient;
use models_email::gmail::EmailSignature;
use models_email::gmail::error::GmailError;

#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_email_signature(
    client: &GmailClient,
    access_token: &str,
    email_address: &str,
) -> Result<Option<String>, GmailError> {
    let url = format!(
        "{}/users/me/settings/sendAs/{}",
        client.base_url, email_address
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| GmailError::HttpRequest(e.to_string()))?;

    let response = response.error_for_status().map_err(|e| match e.status() {
        Some(status) if status.as_u16() == 401 => GmailError::Unauthorized,
        Some(status) if status.as_u16() == 429 => GmailError::RateLimitExceeded,
        Some(status) if status.as_u16() == 404 => GmailError::NotFound(format!(
            "Gmail API returned 404 for email_address: {}",
            email_address
        )),
        _ => GmailError::ApiError(e.to_string()),
    })?;

    let email_signature = response
        .json::<EmailSignature>()
        .await
        .map_err(|e| GmailError::BodyReadError(e.to_string()))?;

    Ok((!email_signature.signature.is_empty()).then_some(email_signature.signature))
}
