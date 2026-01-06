use crate::config::Config;
use anyhow::Context;

/// Gets a fresh Gmail access token by:
/// 1. Looking up the user in FusionAuth
/// 2. Getting their identity provider link with refresh token
/// 3. Using that refresh token to get a new Gmail access token
pub async fn get_gmail_access_token(config: &Config, macro_id: &str) -> anyhow::Result<String> {
    let client = reqwest::Client::builder().build()?;

    // First request: Get user by email
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", config.fusionauth_api_key.parse()?);

    let user_email = macro_id.strip_prefix("macro|").unwrap();

    let url = format!(
        "{}/api/user?email={}",
        config.fusionauth_base_url, user_email
    );
    let request = client.request(reqwest::Method::GET, &url).headers(headers);

    let response = request.send().await?;
    let user_response: serde_json::Value = response.json().await?;

    // Extract user.id from the first response
    let user_id = user_response["user"]["id"]
        .as_str()
        .context("Failed to extract user.id from first response")?;

    // Second request: Get identity provider links using the user.id
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", config.fusionauth_api_key.parse()?);

    let url = format!(
        "{}/api/identity-provider/link?identityProviderId={}&userId={}",
        config.fusionauth_base_url, config.fusionauth_identity_provider_id, user_id
    );
    let request = client.request(reqwest::Method::GET, &url).headers(headers);

    let response = request.send().await?;
    let identity_response: serde_json::Value = response.json().await?;

    // Extract identityProviderLinks[0].token from the second response
    let refresh_token = identity_response["identityProviderLinks"][0]["token"]
        .as_str()
        .context("Failed to extract identityProviderLinks[0].token from second response")?;

    // Third request: Use the extracted token as refresh_token
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse()?);

    let data = serde_json::json!({
        "client_id": config.gmail_client_id,
        "client_secret": config.gmail_client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    });

    let request = client
        .request(reqwest::Method::POST, "https://oauth2.googleapis.com/token")
        .headers(headers)
        .json(&data);

    let response = request.send().await?;
    let token_response: serde_json::Value = response.json().await?;

    // Extract the access token from the response
    let access_token = token_response["access_token"]
        .as_str()
        .context("Failed to extract access_token from Gmail OAuth response")?;

    Ok(access_token.to_string())
}
