use macro_service_urls::GoogleOauthTokenInfoUrl;

#[cfg(test)]
mod test;

/// Ask Google (or the endpoint `OVERRIDE_GOOGLE_OAUTH_TOKEN_INFO_URL` names)
/// which scopes an access token actually carries.
pub(super) async fn fetch_token_scopes(
    token_info_url: &GoogleOauthTokenInfoUrl,
    access_token: &str,
) -> anyhow::Result<Vec<String>> {
    #[derive(serde::Deserialize)]
    struct TokenInfo {
        scope: String,
    }
    // One shared client with a hard timeout: discovery runs on the
    // authentication path, so a hung Google response must not stall login.
    static TOKENINFO_CLIENT: std::sync::LazyLock<reqwest::Client> =
        std::sync::LazyLock::new(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("static reqwest client configuration is valid")
        });
    let info: TokenInfo = TOKENINFO_CLIENT
        .post(token_info_url.as_str())
        .form(&[("access_token", access_token)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(info
        .scope
        .split_ascii_whitespace()
        .map(ToOwned::to_owned)
        .collect())
}
