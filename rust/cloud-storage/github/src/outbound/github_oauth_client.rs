//! Github Oauth Client implementation of the [`GithubOauth`] port.

use std::time::Duration;

use crate::domain::{
    models::{GithubExchangeTokenResponse, GithubPullRequestDetails, GithubUserInfo},
    ports::GithubOauth,
};

/// Github email information from /user/emails endpoint
#[derive(Debug, serde::Deserialize)]
struct GithubEmail {
    /// The email
    email: String,
    /// If the email is primary
    primary: bool,
    /// If the email is verified
    verified: bool,
}

/// Github Oauth implementation
#[derive(Clone, Default)]
pub struct GithubOauthImpl {
    /// The reqwest client
    client: reqwest::Client,
}

impl GithubOauth for GithubOauthImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    fn construct_oauth_url<T: serde::Serialize + std::fmt::Debug + 'static>(
        &self,
        client_id: &str,
        redirect_uri: &str,
        state: T,
    ) -> Result<String, Self::Err> {
        let state_str = serde_json::to_string(&state)?;

        let url = format!(
            "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
            client_id,
            urlencoding::encode(redirect_uri),
            urlencoding::encode("repo user:email"),
            urlencoding::encode(&state_str)
        );

        Ok(url)
    }

    #[tracing::instrument(skip(self, client_secret), err)]
    async fn exchange_oauth_code_for_tokens(
        &self,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
        code: &str,
    ) -> Result<GithubExchangeTokenResponse, Self::Err> {
        #[derive(serde::Serialize)]
        struct TokenRequest<'a> {
            client_id: &'a str,
            client_secret: &'a str,
            code: &'a str,
            redirect_uri: &'a str,
        }

        let token_request = TokenRequest {
            client_id,
            client_secret,
            code,
            redirect_uri,
        };

        let response = self
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .json(&token_request)
            .timeout(Duration::from_secs(30))
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            anyhow::bail!("token exchange failed {}", error_body)
        }

        let token_response: GithubExchangeTokenResponse = response.json().await?;

        Ok(token_response)
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_user_info(&self, access_token: &str) -> Result<GithubUserInfo, Self::Err> {
        // Get basic user info
        let user_response = self
            .client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "Macro-Auth-Service")
            .timeout(Duration::from_secs(30))
            .send()
            .await?;

        let status = user_response.status();

        if !status.is_success() {
            let error_body = user_response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());

            // Check for 401 Unauthorized - token expired or invalid
            if status.as_u16() == 401 {
                tracing::warn!(error_body=%error_body, "GitHub token expired or invalid");
                anyhow::bail!("token expired")
            }

            anyhow::bail!("failed to get user info {}", error_body)
        }

        let mut user_info: GithubUserInfo = user_response.json().await?;

        // If email is not public, try to fetch from emails endpoint (optional)
        if user_info.email.is_none() {
            tracing::debug!("Email not in public profile, attempting to fetch from /user/emails");

            match self
                .client
                .get("https://api.github.com/user/emails")
                .header("Authorization", format!("Bearer {}", access_token))
                .header("User-Agent", "Macro-Auth-Service")
                .timeout(Duration::from_secs(30))
                .send()
                .await
            {
                Ok(emails_response) => {
                    let status = emails_response.status();
                    tracing::trace!(status=?status, "received response from /user/emails");

                    if status.is_success() {
                        match emails_response.json::<Vec<GithubEmail>>().await {
                            Ok(emails) => {
                                tracing::debug!(
                                    email_count = emails.len(),
                                    "Fetched emails from GitHub"
                                );

                                // Find the primary verified email
                                if let Some(primary_email) = emails
                                    .iter()
                                    .find(|e| e.primary && e.verified)
                                    .or_else(|| emails.iter().find(|e| e.verified))
                                {
                                    tracing::debug!(email=?primary_email.email, "Found verified email");
                                    user_info.email = Some(primary_email.email.clone());
                                } else {
                                    tracing::debug!("No verified email found in GitHub account");
                                }
                            }
                            Err(e) => {
                                tracing::error!(error=?e, "Failed to parse emails response");
                            }
                        }
                    } else {
                        let error_body = emails_response.text().await.unwrap_or_default();
                        tracing::warn!(status=?status, error=?error_body, "Failed to fetch user emails from GitHub (non-critical)");
                    }
                }
                Err(e) => {
                    tracing::debug!(error=?e, "Failed to fetch user emails (non-critical)");
                }
            }
        }

        Ok(user_info)
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, Self::Err> {
        let response = self
            .client
            .get(format!(
                "https://api.github.com/repos/{owner}/{repo}/pulls/{number}"
            ))
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(Duration::from_secs(15))
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());

            if status.as_u16() == 401 {
                tracing::warn!(error_body=%error_body, "GitHub token expired or invalid");
                anyhow::bail!("unauthorized access")
            }

            anyhow::bail!("failed to get pull request details {}", error_body)
        }

        let details: GithubPullRequestDetails = response.json().await?;

        Ok(details)
    }
}
