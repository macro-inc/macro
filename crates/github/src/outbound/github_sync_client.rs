//! Github Sync Client implementation of the [`GithubSyncClient`] port.

use std::time::Duration;

use super::pull_request_metadata::{
    fetch_open_pull_requests_for_installation, fetch_pull_request_metadata,
};

use crate::domain::{
    models::{
        AppJwt, EnrichedGithubPullRequest, GithubAuthenticatedUser, GithubError,
        GithubInstallationAccessToken, GithubPullRequestDetails, GithubSetupAccessToken,
        GithubUserInstallation, GithubUserInstallationsPage,
    },
    ports::GithubSyncClient,
};

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const GITHUB_OAUTH_BASE_URL: &str = "https://github.com";
const USER_INSTALLATIONS_PAGE_SIZE: u64 = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[cfg(test)]
mod test;

/// Github sync client implementation backed by a reusable [`reqwest::Client`].
#[derive(Clone)]
pub struct GithubSyncClientImpl {
    /// The reqwest client
    client: reqwest::Client,
    #[cfg(test)]
    api_base_url: Option<String>,
}

impl Default for GithubSyncClientImpl {
    fn default() -> Self {
        Self {
            client: build_client(),
            #[cfg(test)]
            api_base_url: None,
        }
    }
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("GitHub sync reqwest client should build")
}

impl GithubSyncClientImpl {
    fn api_base_url(&self) -> &str {
        #[cfg(test)]
        if let Some(api_base_url) = &self.api_base_url {
            return api_base_url;
        }

        GITHUB_API_BASE_URL
    }

    fn oauth_base_url(&self) -> &str {
        #[cfg(test)]
        if let Some(api_base_url) = &self.api_base_url {
            return api_base_url;
        }

        GITHUB_OAUTH_BASE_URL
    }

    #[cfg(test)]
    fn with_api_base_url(api_base_url: String) -> Self {
        Self {
            client: build_client(),
            api_base_url: Some(api_base_url),
        }
    }
}

impl GithubSyncClient for GithubSyncClientImpl {
    #[tracing::instrument(skip(self, client_secret, code), err)]
    async fn exchange_setup_code(
        &self,
        client_id: &str,
        client_secret: &str,
        code: &str,
    ) -> Result<GithubSetupAccessToken, GithubError> {
        #[derive(serde::Serialize)]
        struct TokenRequest<'a> {
            client_id: &'a str,
            client_secret: &'a str,
            code: &'a str,
        }

        let response = self
            .client
            .post(format!(
                "{}/login/oauth/access_token",
                self.oauth_base_url()
            ))
            .header("Accept", "application/json")
            .json(&TokenRequest {
                client_id,
                client_secret,
                code,
            })
            .send()
            .await
            .map_err(|_| {
                GithubError::Internal(anyhow::anyhow!(
                    "GitHub setup token exchange request failed"
                ))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(GithubError::Internal(anyhow::anyhow!(
                "GitHub setup token exchange failed with status {status}"
            )));
        }

        response.json().await.map_err(|_| {
            GithubError::Internal(anyhow::anyhow!(
                "GitHub setup token exchange returned a malformed response"
            ))
        })
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn list_user_installations(
        &self,
        access_token: &str,
    ) -> Result<Vec<GithubUserInstallation>, GithubError> {
        let mut page = 1_u64;
        let mut installations = Vec::new();

        loop {
            let response = self
                .client
                .get(format!(
                    "{}/user/installations?per_page={USER_INSTALLATIONS_PAGE_SIZE}&page={page}",
                    self.api_base_url()
                ))
                .header("Authorization", format!("Bearer {access_token}"))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "Macro-Auth-Service")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .await
                .map_err(|_| {
                    GithubError::Internal(anyhow::anyhow!(
                        "GitHub user installation list request failed"
                    ))
                })?;

            let status = response.status();
            if !status.is_success() {
                return Err(GithubError::Internal(anyhow::anyhow!(
                    "GitHub user installation list failed with status {status}"
                )));
            }

            let response_page: GithubUserInstallationsPage =
                response.json().await.map_err(|_| {
                    GithubError::Internal(anyhow::anyhow!(
                        "GitHub user installation list returned a malformed response"
                    ))
                })?;
            let total_count = response_page.total_count;
            let page_is_empty = response_page.installations.is_empty();
            installations.extend(response_page.installations);

            if installations.len() as u64 >= total_count {
                return Ok(installations);
            }
            if page_is_empty {
                return Err(GithubError::Internal(anyhow::anyhow!(
                    "GitHub user installation pagination ended before total_count"
                )));
            }

            page = page.checked_add(1).ok_or_else(|| {
                GithubError::Internal(anyhow::anyhow!(
                    "GitHub user installation pagination exceeded page limit"
                ))
            })?;
        }
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_authenticated_user(
        &self,
        access_token: &str,
    ) -> Result<GithubAuthenticatedUser, GithubError> {
        let response = self
            .client
            .get(format!("{}/user", self.api_base_url()))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|_| {
                GithubError::Internal(anyhow::anyhow!("GitHub authenticated user request failed"))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(GithubError::Internal(anyhow::anyhow!(
                "GitHub authenticated user request failed with status {status}"
            )));
        }

        response.json().await.map_err(|_| {
            GithubError::Internal(anyhow::anyhow!(
                "GitHub authenticated user request returned a malformed response"
            ))
        })
    }

    #[tracing::instrument(skip(self, jwt), err)]
    async fn generate_installation_access_token(
        &self,
        jwt: &AppJwt,
        installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        let response = self
            .client
            .post(format!(
                "https://api.github.com/app/installations/{installation_id}/access_tokens"
            ))
            .header("Authorization", format!("Bearer {}", jwt.as_str()))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            return Err(GithubError::Internal(anyhow::anyhow!(
                "failed to create installation access token (status {status}): {error_body}"
            )));
        }

        let token: GithubInstallationAccessToken = response
            .json()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(token)
    }

    #[tracing::instrument(skip(self, jwt), err)]
    async fn get_repository_installation(
        &self,
        jwt: &AppJwt,
        owner: &str,
        repository: &str,
    ) -> Result<Option<u64>, GithubError> {
        #[derive(serde::Deserialize)]
        struct InstallationResponse {
            id: u64,
        }

        let response = self
            .client
            .get(format!(
                "{}/repos/{owner}/{repository}/installation",
                self.api_base_url()
            ))
            .header("Authorization", format!("Bearer {}", jwt.as_str()))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        // Not installed and not visible to our App look the same from here, and
        // both mean the same thing to a caller: no token is coming.
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            return Err(GithubError::Internal(anyhow::anyhow!(
                "failed to look up a repository installation (status {status}): {error_body}"
            )));
        }

        let installation: InstallationResponse = response
            .json()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(Some(installation.id))
    }

    #[tracing::instrument(skip(self, jwt), err)]
    async fn generate_scoped_installation_access_token(
        &self,
        jwt: &AppJwt,
        installation_id: u64,
        repository: &str,
        permissions: &[(&str, &str)],
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        /// The narrowing GitHub applies to the minted token. Omitting either
        /// field widens it to everything the installation can reach, so both
        /// are always sent.
        #[derive(serde::Serialize)]
        struct ScopedTokenRequest<'a> {
            /// Names only, without the owner - GitHub resolves them within the
            /// installation.
            repositories: [&'a str; 1],
            /// Permission name to level, as GitHub names them.
            permissions: std::collections::BTreeMap<&'a str, &'a str>,
        }

        let body = ScopedTokenRequest {
            repositories: [repository],
            permissions: permissions.iter().copied().collect(),
        };

        let response = self
            .client
            .post(format!(
                "{}/app/installations/{installation_id}/access_tokens",
                self.api_base_url()
            ))
            .header("Authorization", format!("Bearer {}", jwt.as_str()))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&body)
            .send()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            return Err(GithubError::Internal(anyhow::anyhow!(
                "failed to create a scoped installation access token (status {status}): {error_body}"
            )));
        }

        response
            .json()
            .await
            .map_err(|e| GithubError::Internal(e.into()))
    }

    #[tracing::instrument(skip(self, access_token, body), err)]
    async fn create_pr_comment(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        body: &str,
    ) -> Result<(), GithubError> {
        let response = self
            .client
            .post(format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{pull_number}/comments"
            ))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Macro-Auth-Service")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            return Err(GithubError::Internal(anyhow::anyhow!(
                "failed to create PR comment (status {status}): {error_body}"
            )));
        }

        Ok(())
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, GithubError> {
        fetch_pull_request_metadata(&self.client, access_token, owner, repo, number)
            .await
            .map_err(GithubError::Internal)
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn list_open_pull_requests(
        &self,
        access_token: &str,
    ) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
        fetch_open_pull_requests_for_installation(&self.client, access_token)
            .await
            .map_err(GithubError::Internal)
    }
}
