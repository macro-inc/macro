use crate::GmailClient;
use anyhow::Context;
use models_email::gmail::GmailUserProfile;

#[tracing::instrument(skip(client, access_token), level = "debug")]
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

    let response = response
        .error_for_status()
        .context("Gmail API returned an error status (get user profile)")?;

    // Parse the response directly into our GmailUserProfile structure
    let user_profile = response
        .json::<GmailUserProfile>()
        .await
        .context("Failed to parse Gmail API response into user profile")?;

    Ok(user_profile.threads_total)
}
