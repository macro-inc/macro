//! Github Oauth Client implementation of the [`GithubOauth`] port.

use std::time::Duration;

use super::pull_request_metadata::fetch_pull_request_metadata;

use crate::domain::{
    models::{
        GithubDraftOutcome, GithubExchangeTokenResponse, GithubMergeMethod, GithubMergeOutcome,
        GithubMergeRejection, GithubPullRequestDetails, GithubPullRequestMerge,
        GithubPullRequestMergeability, GithubPullRequestMergeabilityEntry, GithubPullRequestNumber,
        GithubPullRequestUpdateRejection, GithubRepositoryMergeSettings, GithubUserInfo,
    },
    ports::GithubOauth,
};

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const USER_AGENT: &str = "Macro-Auth-Service";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

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
    #[cfg(test)]
    api_base_url: Option<String>,
}

/// The `message` GitHub puts in every error body.
#[derive(serde::Deserialize)]
struct GithubErrorBody {
    message: String,
}

/// Repository settings as GitHub returns them. The `allow_*` fields are only
/// present for users who can see them; absent means the default, which is
/// allowed.
#[derive(serde::Deserialize)]
struct RepositorySettingsResponse {
    #[serde(default = "default_true")]
    allow_merge_commit: bool,
    #[serde(default = "default_true")]
    allow_squash_merge: bool,
    #[serde(default = "default_true")]
    allow_rebase_merge: bool,
}

fn default_true() -> bool {
    true
}

/// A GraphQL answer: data, errors, or both when part of the query failed.
#[derive(serde::Deserialize)]
struct GraphqlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(serde::Deserialize)]
struct GraphqlError {
    message: String,
    #[serde(rename = "type")]
    kind: Option<String>,
}

impl GraphqlError {
    fn rejection(&self) -> GithubPullRequestUpdateRejection {
        match self.kind.as_deref() {
            Some("NOT_FOUND") => GithubPullRequestUpdateRejection::NotFound,
            Some("FORBIDDEN") => GithubPullRequestUpdateRejection::Forbidden,
            _ => GithubPullRequestUpdateRejection::Invalid,
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftStateRepository {
    pull_request: Option<DraftStatePullRequest>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftStatePullRequest {
    id: String,
    is_draft: bool,
}

#[derive(serde::Deserialize)]
struct DraftStateData {
    repository: Option<DraftStateRepository>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeabilityRepository {
    pull_request: Option<MergeabilityPullRequest>,
}

#[derive(serde::Deserialize)]
struct MergeabilityPullRequest {
    mergeable: Option<String>,
}

const DRAFT_STATE_QUERY: &str = "query($owner: String!, $repo: String!, $number: Int!) { \
     repository(owner: $owner, name: $repo) { pullRequest(number: $number) { id isDraft } } }";
const CONVERT_TO_DRAFT_MUTATION: &str = "mutation($id: ID!) { \
     convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }";
const MARK_READY_MUTATION: &str = "mutation($id: ID!) { \
     markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }";

/// One aliased lookup per pull request, so a batch is a single request.
fn mergeability_query(
    pull_requests: &[GithubPullRequestNumber],
) -> (String, serde_json::Map<String, serde_json::Value>) {
    let mut parameters = Vec::with_capacity(pull_requests.len());
    let mut fields = Vec::with_capacity(pull_requests.len());
    let mut variables = serde_json::Map::new();
    for (index, pull_request) in pull_requests.iter().enumerate() {
        parameters.push(format!(
            "$o{index}: String!, $r{index}: String!, $n{index}: Int!"
        ));
        fields.push(format!(
            "p{index}: repository(owner: $o{index}, name: $r{index}) \
             {{ pullRequest(number: $n{index}) {{ mergeable }} }}"
        ));
        variables.insert(format!("o{index}"), pull_request.owner.clone().into());
        variables.insert(format!("r{index}"), pull_request.repo.clone().into());
        variables.insert(format!("n{index}"), pull_request.number.into());
    }
    (
        format!(
            "query({}) {{ {} }}",
            parameters.join(", "),
            fields.join(" ")
        ),
        variables,
    )
}

fn mergeability(value: Option<&str>) -> GithubPullRequestMergeability {
    match value {
        Some("MERGEABLE") => GithubPullRequestMergeability::Mergeable,
        Some("CONFLICTING") => GithubPullRequestMergeability::Conflicting,
        _ => GithubPullRequestMergeability::Unknown,
    }
}

impl GithubOauthImpl {
    /// Runs a GraphQL request as the user. GraphQL reports refusals in the
    /// body, so only a failed request is an error here.
    async fn graphql<T: serde::de::DeserializeOwned>(
        &self,
        access_token: &str,
        query: &str,
        variables: serde_json::Value,
    ) -> anyhow::Result<GraphqlResponse<T>> {
        let response = self
            .client
            .post(format!("{}/graphql", self.api_base_url()))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("User-Agent", USER_AGENT)
            .json(&serde_json::json!({ "query": query, "variables": variables }))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            anyhow::bail!("GitHub GraphQL request failed (status {status}): {error_body}");
        }

        Ok(response.json().await?)
    }

    fn api_base_url(&self) -> &str {
        #[cfg(test)]
        if let Some(api_base_url) = &self.api_base_url {
            return api_base_url;
        }

        GITHUB_API_BASE_URL
    }

    #[cfg(test)]
    fn with_api_base_url(api_base_url: String) -> Self {
        Self {
            client: reqwest::Client::default(),
            api_base_url: Some(api_base_url),
        }
    }
}

impl GithubOauth for GithubOauthImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    fn construct_oauth_url(
        &self,
        client_id: &str,
        redirect_uri: &str,
        state: &str,
    ) -> Result<String, Self::Err> {
        let url = format!(
            "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
            client_id,
            urlencoding::encode(redirect_uri),
            urlencoding::encode("repo user:email"),
            urlencoding::encode(state)
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
    async fn is_access_token_expired(&self, access_token: &str) -> Result<bool, Self::Err> {
        let user_response = self
            .client
            .get("https://api.github.com/user")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "Macro-Auth-Service")
            .timeout(Duration::from_secs(30))
            .send()
            .await?;

        let status = user_response.status();

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Ok(true);
        }

        if !status.is_success() {
            let error_body = user_response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            anyhow::bail!("failed to validate access token {}", error_body);
        }

        Ok(false)
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_pull_request_details(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<GithubPullRequestDetails, Self::Err> {
        fetch_pull_request_metadata(&self.client, access_token, owner, repo, number).await
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn get_repository_merge_settings(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
    ) -> Result<GithubRepositoryMergeSettings, Self::Err> {
        let response = self
            .client
            .get(format!("{}/repos/{owner}/{repo}", self.api_base_url()))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());
            anyhow::bail!("failed to read repository settings (status {status}): {error_body}");
        }

        let settings: RepositorySettingsResponse = response.json().await?;

        Ok(GithubRepositoryMergeSettings {
            allow_merge_commit: settings.allow_merge_commit,
            allow_squash_merge: settings.allow_squash_merge,
            allow_rebase_merge: settings.allow_rebase_merge,
        })
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn merge_pull_request(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
        merge_method: GithubMergeMethod,
    ) -> Result<GithubMergeOutcome, Self::Err> {
        #[derive(serde::Serialize)]
        struct MergeRequest {
            merge_method: GithubMergeMethod,
        }

        #[derive(serde::Deserialize)]
        struct MergeResponse {
            sha: String,
            message: String,
        }

        let response = self
            .client
            .put(format!(
                "{}/repos/{owner}/{repo}/pulls/{number}/merge",
                self.api_base_url()
            ))
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&MergeRequest { merge_method })
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?;

        let status = response.status();
        if status.is_success() {
            let merged: MergeResponse = response.json().await?;
            return Ok(GithubMergeOutcome::Merged(GithubPullRequestMerge {
                sha: merged.sha,
                message: merged.message,
            }));
        }

        // The statuses GitHub documents for this endpoint, each a decision
        // about the pull request rather than a failure to reach GitHub.
        let rejection = match status {
            reqwest::StatusCode::METHOD_NOT_ALLOWED => GithubMergeRejection::NotMergeable,
            reqwest::StatusCode::CONFLICT => GithubMergeRejection::HeadChanged,
            reqwest::StatusCode::NOT_FOUND => GithubMergeRejection::NotFound,
            reqwest::StatusCode::FORBIDDEN => GithubMergeRejection::Forbidden,
            reqwest::StatusCode::UNPROCESSABLE_ENTITY => GithubMergeRejection::Invalid,
            _ => {
                let error_body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "unknown error".to_string());
                anyhow::bail!("failed to merge pull request (status {status}): {error_body}");
            }
        };
        let message = response
            .json::<GithubErrorBody>()
            .await
            .map(|body| body.message)
            .unwrap_or_else(|_| "GitHub declined to merge the pull request.".to_string());

        Ok(GithubMergeOutcome::Rejected { rejection, message })
    }

    #[tracing::instrument(skip(self, access_token), err)]
    async fn set_pull_request_draft(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        number: u64,
        draft: bool,
    ) -> Result<GithubDraftOutcome, Self::Err> {
        let state: GraphqlResponse<DraftStateData> = self
            .graphql(
                access_token,
                DRAFT_STATE_QUERY,
                serde_json::json!({ "owner": owner, "repo": repo, "number": number }),
            )
            .await?;
        let pull_request = state
            .data
            .and_then(|data| data.repository)
            .and_then(|repository| repository.pull_request);
        let Some(pull_request) = pull_request else {
            let error = state.errors.into_iter().next();
            return Ok(GithubDraftOutcome::Rejected {
                rejection: error
                    .as_ref()
                    .map(GraphqlError::rejection)
                    .unwrap_or(GithubPullRequestUpdateRejection::NotFound),
                message: error
                    .map(|error| error.message)
                    .unwrap_or_else(|| "GitHub could not find the pull request.".to_string()),
            });
        };
        if pull_request.is_draft == draft {
            return Ok(GithubDraftOutcome::Changed { draft });
        }

        let mutation = if draft {
            CONVERT_TO_DRAFT_MUTATION
        } else {
            MARK_READY_MUTATION
        };
        let changed: GraphqlResponse<serde_json::Value> = self
            .graphql(
                access_token,
                mutation,
                serde_json::json!({ "id": pull_request.id }),
            )
            .await?;
        if let Some(error) = changed.errors.into_iter().next() {
            return Ok(GithubDraftOutcome::Rejected {
                rejection: error.rejection(),
                message: error.message,
            });
        }

        Ok(GithubDraftOutcome::Changed { draft })
    }

    #[tracing::instrument(skip(self, access_token, pull_requests), fields(count = pull_requests.len()), err)]
    async fn get_pull_request_mergeability(
        &self,
        access_token: &str,
        pull_requests: &[GithubPullRequestNumber],
    ) -> Result<Vec<GithubPullRequestMergeabilityEntry>, Self::Err> {
        if pull_requests.is_empty() {
            return Ok(Vec::new());
        }

        let (query, variables) = mergeability_query(pull_requests);
        // Pull requests the user cannot see come back as null with an error
        // beside them; they are left out rather than failing the batch.
        let response: GraphqlResponse<
            std::collections::HashMap<String, Option<MergeabilityRepository>>,
        > = self
            .graphql(access_token, &query, serde_json::Value::Object(variables))
            .await?;
        let Some(mut data) = response.data else {
            let message = response
                .errors
                .into_iter()
                .next()
                .map(|error| error.message)
                .unwrap_or_else(|| "no data".to_string());
            anyhow::bail!("failed to read pull request mergeability: {message}");
        };

        Ok(pull_requests
            .iter()
            .enumerate()
            .filter_map(|(index, pull_request)| {
                let found = data.remove(&format!("p{index}")).flatten()?.pull_request?;
                Some(GithubPullRequestMergeabilityEntry {
                    owner: pull_request.owner.clone(),
                    repo: pull_request.repo.clone(),
                    number: pull_request.number,
                    mergeability: mergeability(found.mergeable.as_deref()),
                })
            })
            .collect())
    }
}
