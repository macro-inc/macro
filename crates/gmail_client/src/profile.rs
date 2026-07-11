use crate::GmailClient;
use anyhow::Context;
use models_email::gmail::GmailUserProfile;

#[tracing::instrument(skip(client, access_token), err)]
pub async fn get_profile_threads_total(
    client: &GmailClient,
    access_token: &str,
) -> anyhow::Result<i32> {
    let url = format!("{}/users/me/profile", client.base_url);
    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to Gmail API (get user profile)")?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        anyhow::bail!(
            "Gmail API error {} (get user profile): {}",
            status,
            error_body
        );
    }

    // Parse the response directly into our GmailUserProfile structure
    let user_profile = response
        .json::<GmailUserProfile>()
        .await
        .context("Failed to parse Gmail API response into user profile")?;

    Ok(user_profile.threads_total)
}
