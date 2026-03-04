//! Github Sync Client implementation of the [`GithubSyncClient`] port.

use crate::domain::{
    models::{GithubError, GithubInstallationAccessToken},
    ports::GithubSyncClient,
};

/// Github sync client implementation backed by a reusable [`reqwest::Client`].
#[derive(Clone, Default)]
pub struct GithubSyncClientImpl {
    /// The reqwest client
    client: reqwest::Client,
}

impl GithubSyncClient for GithubSyncClientImpl {
    #[tracing::instrument(skip(self, jwt), err)]
    async fn generate_installation_access_token(
        &self,
        jwt: &str,
        installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        let response = self
            .client
            .post(format!(
                "https://api.github.com/app/installations/{installation_id}/access_tokens"
            ))
            .header("Authorization", format!("Bearer {jwt}"))
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
    async fn list_pr_comments(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
    ) -> Result<Vec<String>, GithubError> {
        let response = self
            .client
            .get(format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{pull_number}/comments"
            ))
            .header("Authorization", format!("Bearer {access_token}"))
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
                "failed to list PR comments (status {status}): {error_body}"
            )));
        }

        let comments: Vec<serde_json::Value> = response
            .json()
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(comments
            .into_iter()
            .filter_map(|c| c.get("body")?.as_str().map(String::from))
            .collect())
    }
}
