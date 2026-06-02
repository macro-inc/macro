//! Shared GitHub pull request metadata fetcher.

use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::domain::models::{
    EnrichedGithubPullRequest, GithubKey, GithubPullRequestCheckRun, GithubPullRequestComment,
    GithubPullRequestDetails, GithubPullRequestStatus,
};

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const METADATA_PAGE_SIZE: u16 = 100;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = "Macro-Auth-Service";

/// Fetch GitHub pull request details with comments and check runs when available.
pub(crate) async fn fetch_pull_request_metadata(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<GithubPullRequestDetails, anyhow::Error> {
    let pull_request = fetch_pull_request(client, access_token, owner, repo, number).await?;
    let comments = fetch_comments(client, access_token, owner, repo, number).await;
    let checks = fetch_check_runs(
        client,
        access_token,
        owner,
        repo,
        pull_request.head.sha.as_str(),
    )
    .await;

    Ok(GithubPullRequestDetails {
        title: pull_request.title,
        state: pull_request.state,
        merged_at: pull_request.merged_at,
        additions: pull_request.additions,
        deletions: pull_request.deletions,
        comments,
        checks,
    })
}

/// Fetch open pull requests for every repository accessible to an installation token.
pub(crate) async fn fetch_open_pull_requests_for_installation(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Vec<EnrichedGithubPullRequest>, anyhow::Error> {
    let repositories = fetch_installation_repositories(client, access_token).await?;
    let mut open_pull_requests = Vec::new();

    for repository in repositories {
        match fetch_open_pull_requests_for_repository(client, access_token, &repository).await {
            Ok(repository_pull_requests) => open_pull_requests.extend(repository_pull_requests),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    owner=%repository.owner.login,
                    repo=%repository.name,
                    "failed to fetch GitHub open pull requests for repository"
                );
            }
        }
    }

    Ok(open_pull_requests)
}

async fn fetch_installation_repositories(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Vec<GithubInstallationRepositoryResponse>, anyhow::Error> {
    fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/installation/repositories?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "installation repositories",
        |response: GithubInstallationRepositoriesResponse| response.repositories,
    )
    .await
}

async fn fetch_open_pull_requests_for_repository(
    client: &reqwest::Client,
    access_token: &str,
    repository: &GithubInstallationRepositoryResponse,
) -> Result<Vec<EnrichedGithubPullRequest>, anyhow::Error> {
    let owner = repository.owner.login.as_str();
    let repo = repository.name.as_str();
    let pull_requests = fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/pulls?state=open&per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "open pull requests",
        |pull_requests: Vec<GithubOpenPullRequestResponse>| pull_requests,
    )
    .await?;

    Ok(pull_requests
        .into_iter()
        .map(|pull_request| pull_request.into_enriched_pull_request(owner, repo))
        .collect())
}

#[derive(Debug, serde::Deserialize)]
struct GithubInstallationRepositoriesResponse {
    repositories: Vec<GithubInstallationRepositoryResponse>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubInstallationRepositoryResponse {
    name: String,
    owner: GithubRepositoryOwnerResponse,
}

#[derive(Debug, serde::Deserialize)]
struct GithubRepositoryOwnerResponse {
    login: String,
}

#[derive(Debug, serde::Deserialize)]
struct GithubOpenPullRequestResponse {
    number: u64,
    title: String,
    html_url: String,
}

#[derive(Debug, serde::Deserialize)]
struct GithubPullRequestResponse {
    title: String,
    state: String,
    merged_at: Option<chrono::DateTime<chrono::Utc>>,
    additions: u64,
    deletions: u64,
    head: GithubPullRequestHeadResponse,
}

#[derive(Debug, serde::Deserialize)]
struct GithubPullRequestHeadResponse {
    sha: String,
}

#[derive(Debug, serde::Deserialize)]
struct GithubUserResponse {
    login: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubCommentResponse {
    id: u64,
    body: Option<String>,
    user: Option<GithubUserResponse>,
    author_association: Option<String>,
    html_url: Option<String>,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubReviewResponse {
    id: u64,
    body: Option<String>,
    user: Option<GithubUserResponse>,
    author_association: Option<String>,
    html_url: Option<String>,
    submitted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubCheckRunsResponse {
    check_runs: Vec<GithubCheckRunResponse>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubCheckRunResponse {
    id: u64,
    name: String,
    status: String,
    conclusion: Option<String>,
    html_url: Option<String>,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn fetch_pull_request(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<GithubPullRequestResponse, anyhow::Error> {
    let url = format!("{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/pulls/{number}");
    let response = github_get(client, access_token, url).send().await?;
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

    response.json().await.map_err(Into::into)
}

async fn fetch_comments(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<Vec<GithubPullRequestComment>> {
    let mut comments = fetch_issue_comments(client, access_token, owner, repo, number).await?;

    comments.extend(fetch_review_comments(client, access_token, owner, repo, number).await?);
    comments.extend(fetch_reviews(client, access_token, owner, repo, number).await?);

    Some(comments)
}

async fn fetch_issue_comments(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<Vec<GithubPullRequestComment>> {
    match fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/issues/{number}/comments?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request issue comments",
        |comments: Vec<GithubCommentResponse>| comments,
    )
    .await
    {
        Ok(comments) => Some(
            comments
                .into_iter()
                .map(|comment| comment.into_pull_request_comment("issue_comment"))
                .collect(),
        ),
        Err(error) => {
            tracing::warn!(
                error=?error,
                owner=%owner,
                repo=%repo,
                number=number,
                "failed to fetch GitHub pull request issue comments"
            );
            None
        }
    }
}

async fn fetch_review_comments(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<Vec<GithubPullRequestComment>> {
    match fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/pulls/{number}/comments?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request review comments",
        |comments: Vec<GithubCommentResponse>| comments,
    )
    .await
    {
        Ok(comments) => Some(
            comments
                .into_iter()
                .map(|comment| comment.into_pull_request_comment("review_comment"))
                .collect(),
        ),
        Err(error) => {
            tracing::warn!(
                error=?error,
                owner=%owner,
                repo=%repo,
                number=number,
                "failed to fetch GitHub pull request review comments"
            );
            None
        }
    }
}

async fn fetch_reviews(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<Vec<GithubPullRequestComment>> {
    match fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/pulls/{number}/reviews?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request reviews",
        |reviews: Vec<GithubReviewResponse>| reviews,
    )
    .await
    {
        Ok(reviews) => Some(
            reviews
                .into_iter()
                .filter_map(GithubReviewResponse::into_pull_request_comment)
                .collect(),
        ),
        Err(error) => {
            tracing::warn!(
                error=?error,
                owner=%owner,
                repo=%repo,
                number=number,
                "failed to fetch GitHub pull request reviews"
            );
            None
        }
    }
}

async fn fetch_check_runs(
    client: &reqwest::Client,
    access_token: &str,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> Option<Vec<GithubPullRequestCheckRun>> {
    match fetch_paginated_github_items(
        client,
        access_token,
        |page| {
            format!(
                "{GITHUB_API_BASE_URL}/repos/{owner}/{repo}/commits/{head_sha}/check-runs?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "check runs",
        |response: GithubCheckRunsResponse| response.check_runs,
    )
    .await
    {
        Ok(check_runs) => Some(
            check_runs
                .into_iter()
                .map(GithubCheckRunResponse::into_pull_request_check_run)
                .collect(),
        ),
        Err(error) => {
            tracing::warn!(
                error=?error,
                owner=%owner,
                repo=%repo,
                head_sha=%head_sha,
                "failed to fetch GitHub pull request check runs"
            );
            None
        }
    }
}

async fn fetch_paginated_github_items<Response, Item, UrlForPage, ItemsFromResponse>(
    client: &reqwest::Client,
    access_token: &str,
    mut url_for_page: UrlForPage,
    description: &str,
    mut items_from_response: ItemsFromResponse,
) -> Result<Vec<Item>, anyhow::Error>
where
    Response: DeserializeOwned,
    UrlForPage: FnMut(u32) -> String,
    ItemsFromResponse: FnMut(Response) -> Vec<Item>,
{
    let mut all_items = Vec::new();
    let mut page = 1;

    loop {
        let response =
            fetch_github_json::<Response>(client, access_token, url_for_page(page), description)
                .await?;
        let page_items = items_from_response(response);
        let is_last_page = page_items.len() < usize::from(METADATA_PAGE_SIZE);

        all_items.extend(page_items);

        if is_last_page {
            break;
        }

        page += 1;
    }

    Ok(all_items)
}

async fn fetch_github_json<T>(
    client: &reqwest::Client,
    access_token: &str,
    url: String,
    description: &str,
) -> Result<T, anyhow::Error>
where
    T: DeserializeOwned,
{
    let response = github_get(client, access_token, url).send().await?;
    let status = response.status();

    if !status.is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        anyhow::bail!("failed to get {description} (status {status}): {error_body}")
    }

    response.json().await.map_err(Into::into)
}

fn github_get(
    client: &reqwest::Client,
    access_token: &str,
    url: String,
) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", USER_AGENT)
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(REQUEST_TIMEOUT)
}

impl GithubOpenPullRequestResponse {
    fn into_enriched_pull_request(self, owner: &str, repo: &str) -> EnrichedGithubPullRequest {
        EnrichedGithubPullRequest {
            github_key: GithubKey::new(owner, repo, self.number).to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
            number: self.number,
            url: self.html_url,
            display_name: format!("{owner}/{repo}#{}", self.number),
            name: Some(self.title),
            status: Some(GithubPullRequestStatus::Open),
            additions: None,
            deletions: None,
            comments: None,
            checks: None,
        }
    }
}

impl GithubCommentResponse {
    fn into_pull_request_comment(self, source: &str) -> GithubPullRequestComment {
        GithubPullRequestComment {
            id: self.id,
            body: self.body.unwrap_or_default(),
            author_login: self.user.and_then(|user| user.login),
            author_association: self.author_association,
            url: self.html_url,
            created_at: self.created_at,
            updated_at: self.updated_at,
            source: source.to_string(),
        }
    }
}

impl GithubReviewResponse {
    fn into_pull_request_comment(self) -> Option<GithubPullRequestComment> {
        let body = self.body.unwrap_or_default();

        if body.trim().is_empty() {
            return None;
        }

        Some(GithubPullRequestComment {
            id: self.id,
            body,
            author_login: self.user.and_then(|user| user.login),
            author_association: self.author_association,
            url: self.html_url,
            created_at: self.submitted_at,
            updated_at: None,
            source: "review".to_string(),
        })
    }
}

impl GithubCheckRunResponse {
    fn into_pull_request_check_run(self) -> GithubPullRequestCheckRun {
        GithubPullRequestCheckRun {
            id: self.id,
            name: self.name,
            status: self.status,
            conclusion: self.conclusion,
            url: self.html_url,
            started_at: self.started_at,
            completed_at: self.completed_at,
        }
    }
}
