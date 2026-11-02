//! Shared GitHub pull request metadata fetcher.

#![allow(dead_code)]

use std::collections::BTreeSet;

use serde::de::DeserializeOwned;

use super::github_http::{GithubHttp, GithubRequest, unexpected};
use crate::domain::models::{
    EnrichedGithubPullRequest, GitRef, GithubError, GithubKey, GithubPullRequestCheckRun,
    GithubPullRequestComment, GithubPullRequestDetails, GithubPullRequestLabel,
    GithubPullRequestReview, GithubPullRequestReviewState, GithubPullRequestStatus,
    GithubPullRequestUser, GithubRepository, latest_reviews,
};

const METADATA_PAGE_SIZE: u16 = 100;

/// Fetch GitHub pull request details with comments and check runs when available.
pub(crate) async fn fetch_pull_request_metadata(
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<GithubPullRequestDetails, GithubError> {
    let pull_request = fetch_pull_request(http, access_token, owner, repo, number).await?;
    let discussion = fetch_comments(http, access_token, owner, repo, number).await;
    let checks = fetch_check_runs(
        http,
        access_token,
        owner,
        repo,
        pull_request.head.sha.as_str(),
    )
    .await;

    let mut participant_ids = pull_request.participant_ids();
    let (comments, reviews) = match discussion {
        Some(discussion) => {
            participant_ids.extend(discussion.participant_ids);
            (Some(discussion.comments), Some(discussion.reviews))
        }
        None => (None, None),
    };
    // A failed comments fetch still yields the partial author/reviewer/assignee set; stored
    // metadata merges participants as a union, so partial sets are safe.
    let participant_github_user_ids =
        (!participant_ids.is_empty()).then(|| participant_ids.iter().map(u64::to_string).collect());
    let author_login = pull_request
        .user
        .as_ref()
        .and_then(|user| user.login.clone());
    let author_id = pull_request.user.as_ref().and_then(|user| user.id);
    let requested_reviewer_github_user_ids = user_ids(&pull_request.requested_reviewers);

    Ok(GithubPullRequestDetails {
        repository_id: pull_request.base.repository_id(),
        title: pull_request.title,
        state: pull_request.state,
        merged_at: pull_request.merged_at,
        additions: pull_request.additions,
        deletions: pull_request.deletions,
        author_login,
        author_id,
        description: pull_request.body,
        comments,
        checks,
        participant_github_user_ids,
        draft: pull_request.draft,
        requested_reviewer_github_user_ids: Some(requested_reviewer_github_user_ids),
        github_updated_at: pull_request.updated_at,
        assignees: Some(pull_request_users(&pull_request.assignees)),
        labels: Some(pull_request_labels(&pull_request.labels)),
        reviews,
        base: pull_request.base.git_ref(),
        head: Some(pull_request.head.git_ref()),
    })
}

/// Fetch open pull requests for every repository accessible to an installation token.
pub(crate) async fn fetch_open_pull_requests_for_installation(
    http: &GithubHttp,
    access_token: &str,
) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
    let repositories = fetch_installation_repositories(http, access_token).await?;
    let mut open_pull_requests = Vec::new();

    for repository in repositories {
        match fetch_open_pull_requests_for_repository(http, access_token, &repository).await {
            Ok(repository_pull_requests) => open_pull_requests.extend(repository_pull_requests),
            Err(error) => {
                tracing::warn!(
                    error=?error,
                    owner=%repository.owner,
                    repo=%repository.name,
                    "failed to fetch GitHub open pull requests for repository"
                );
            }
        }
    }

    Ok(open_pull_requests)
}

/// Fetch every repository an installation access token can reach.
///
/// The one pager over `/installation/repositories`; both the open-pull-request
/// sweep above and the reachable-repositories service come through here.
pub(crate) async fn fetch_installation_repositories(
    http: &GithubHttp,
    access_token: &str,
) -> Result<Vec<GithubRepository>, GithubError> {
    let repositories: Vec<GithubInstallationRepositoryResponse> = fetch_paginated_github_items(
        http,
        access_token,
        |page| format!("/installation/repositories?per_page={METADATA_PAGE_SIZE}&page={page}"),
        "installation repositories",
        |response: GithubInstallationRepositoriesResponse| response.repositories,
    )
    .await?;

    Ok(repositories
        .into_iter()
        .map(GithubInstallationRepositoryResponse::into_repository)
        .collect())
}

async fn fetch_open_pull_requests_for_repository(
    http: &GithubHttp,
    access_token: &str,
    repository: &GithubRepository,
) -> Result<Vec<EnrichedGithubPullRequest>, GithubError> {
    let owner = repository.owner.as_str();
    let repo = repository.name.as_str();
    let pull_requests = fetch_paginated_github_items(
        http,
        access_token,
        |page| {
            format!(
                "/repos/{owner}/{repo}/pulls?state=open&per_page={METADATA_PAGE_SIZE}&page={page}"
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
    id: u64,
    name: String,
    owner: GithubRepositoryOwnerResponse,
    html_url: String,
    /// Absent on a repository with no commits, so not required of the payload.
    #[serde(default)]
    default_branch: Option<String>,
    private: bool,
}

impl GithubInstallationRepositoryResponse {
    fn into_repository(self) -> GithubRepository {
        GithubRepository {
            owner: self.owner.login,
            name: self.name,
            html_url: self.html_url,
            default_branch: self.default_branch,
            private: self.private,
            id: self.id,
        }
    }
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
    body: Option<String>,
    #[serde(default)]
    base: GithubPullRequestBaseResponse,
    #[serde(default)]
    head: Option<GithubPullRequestHeadResponse>,
    #[serde(default)]
    draft: Option<bool>,
    #[serde(default)]
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    user: Option<GithubUserResponse>,
    #[serde(default)]
    requested_reviewers: Vec<GithubUserResponse>,
    #[serde(default)]
    assignees: Vec<GithubUserResponse>,
    #[serde(default)]
    labels: Vec<GithubLabelResponse>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubPullRequestResponse {
    title: String,
    state: String,
    merged_at: Option<chrono::DateTime<chrono::Utc>>,
    additions: u64,
    deletions: u64,
    body: Option<String>,
    head: GithubPullRequestHeadResponse,
    #[serde(default)]
    base: GithubPullRequestBaseResponse,
    #[serde(default)]
    draft: Option<bool>,
    #[serde(default)]
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
    user: Option<GithubUserResponse>,
    #[serde(default)]
    requested_reviewers: Vec<GithubUserResponse>,
    #[serde(default)]
    assignees: Vec<GithubUserResponse>,
    #[serde(default)]
    labels: Vec<GithubLabelResponse>,
}

impl GithubPullRequestResponse {
    fn participant_ids(&self) -> BTreeSet<u64> {
        structural_participant_ids(
            self.user.as_ref(),
            &self.requested_reviewers,
            &self.assignees,
        )
    }
}

/// Collect the stable numeric ids of a pull request's author, requested reviewers, and assignees.
fn structural_participant_ids(
    user: Option<&GithubUserResponse>,
    requested_reviewers: &[GithubUserResponse],
    assignees: &[GithubUserResponse],
) -> BTreeSet<u64> {
    user.iter()
        .copied()
        .chain(requested_reviewers)
        .chain(assignees)
        .filter_map(|user| user.id)
        .collect()
}

#[derive(Debug, serde::Deserialize)]
struct GithubPullRequestHeadResponse {
    #[serde(default, rename = "ref")]
    name: Option<String>,
    sha: String,
}

impl GithubPullRequestHeadResponse {
    fn git_ref(&self) -> GitRef {
        GitRef {
            name: self.name.clone(),
            sha: Some(self.sha.clone()),
        }
    }
}

#[derive(Debug, Default, serde::Deserialize)]
struct GithubPullRequestBaseResponse {
    repo: Option<GithubRepositoryIdResponse>,
    #[serde(default, rename = "ref")]
    name: Option<String>,
    #[serde(default)]
    sha: Option<String>,
}

impl GithubPullRequestBaseResponse {
    fn repository_id(&self) -> Option<u64> {
        self.repo.as_ref().map(|repo| repo.id)
    }

    fn git_ref(&self) -> Option<GitRef> {
        (self.name.is_some() || self.sha.is_some()).then(|| GitRef {
            name: self.name.clone(),
            sha: self.sha.clone(),
        })
    }
}

#[derive(Debug, serde::Deserialize)]
struct GithubRepositoryIdResponse {
    id: u64,
}

/// The users that have a stable numeric id, with their logins.
fn pull_request_users(users: &[GithubUserResponse]) -> Vec<GithubPullRequestUser> {
    users
        .iter()
        .filter_map(|user| {
            Some(GithubPullRequestUser {
                github_user_id: user.id?.to_string(),
                login: user.login.clone(),
            })
        })
        .collect()
}

fn pull_request_labels(labels: &[GithubLabelResponse]) -> Vec<GithubPullRequestLabel> {
    labels
        .iter()
        .map(|label| GithubPullRequestLabel {
            name: label.name.clone(),
            color: label.color.clone(),
        })
        .collect()
}

#[derive(Debug, serde::Deserialize)]
struct GithubLabelResponse {
    name: String,
    color: Option<String>,
}

/// The stable numeric ids, as strings, of the users that have one.
fn user_ids(users: &[GithubUserResponse]) -> Vec<String> {
    users
        .iter()
        .filter_map(|user| user.id)
        .map(|id| id.to_string())
        .collect()
}

#[derive(Debug, serde::Deserialize)]
struct GithubUserResponse {
    login: Option<String>,
    id: Option<u64>,
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
    // Review-thread linkage and diff anchor; GitHub only returns these for
    // review comments.
    in_reply_to_id: Option<u64>,
    pull_request_review_id: Option<u64>,
    path: Option<String>,
    line: Option<u64>,
    original_line: Option<u64>,
}

#[derive(Debug, serde::Deserialize)]
struct GithubReviewResponse {
    id: u64,
    body: Option<String>,
    state: Option<String>,
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
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<GithubPullRequestResponse, GithubError> {
    let response = http
        .send(GithubRequest::get(
            access_token,
            format!("/repos/{owner}/{repo}/pulls/{number}"),
        ))
        .await?;

    if response.status == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!(error_body=%response.text(), "GitHub token expired or invalid");
        return Err(GithubError::Internal(anyhow::anyhow!(
            "unauthorized access"
        )));
    }
    if !response.status.is_success() {
        return Err(unexpected(&response, "failed to get pull request details"));
    }

    response.json()
}

/// The comments collected for a pull request plus every discussion author's stable numeric id.
///
/// The ids are collected separately because comment conversion drops some authors (reviews with
/// an empty body, such as a plain approval, never become comments).
struct FetchedDiscussion {
    comments: Vec<GithubPullRequestComment>,
    participant_ids: BTreeSet<u64>,
    /// Each reviewer's latest submitted review. Only the reviews fetch fills it.
    reviews: Vec<GithubPullRequestReview>,
}

async fn fetch_comments(
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<FetchedDiscussion> {
    let mut discussion = fetch_issue_comments(http, access_token, owner, repo, number).await?;

    let review_comments = fetch_review_comments(http, access_token, owner, repo, number).await?;
    discussion.comments.extend(review_comments.comments);
    discussion
        .participant_ids
        .extend(review_comments.participant_ids);

    let reviews = fetch_reviews(http, access_token, owner, repo, number).await?;
    discussion.comments.extend(reviews.comments);
    discussion.participant_ids.extend(reviews.participant_ids);
    discussion.reviews = reviews.reviews;

    Some(discussion)
}

async fn fetch_issue_comments(
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<FetchedDiscussion> {
    match fetch_paginated_github_items(
        http,
        access_token,
        |page| {
            format!(
                "/repos/{owner}/{repo}/issues/{number}/comments?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request issue comments",
        |comments: Vec<GithubCommentResponse>| comments,
    )
    .await
    {
        Ok(comments) => Some(FetchedDiscussion {
            participant_ids: author_ids(&comments, |comment| comment.user.as_ref()),
            reviews: Vec::new(),
            comments: comments
                .into_iter()
                .map(|comment| comment.into_pull_request_comment("issue_comment"))
                .collect(),
        }),
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
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<FetchedDiscussion> {
    match fetch_paginated_github_items(
        http,
        access_token,
        |page| {
            format!(
                "/repos/{owner}/{repo}/pulls/{number}/comments?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request review comments",
        |comments: Vec<GithubCommentResponse>| comments,
    )
    .await
    {
        Ok(comments) => Some(FetchedDiscussion {
            participant_ids: author_ids(&comments, |comment| comment.user.as_ref()),
            reviews: Vec::new(),
            comments: comments
                .into_iter()
                .map(|comment| comment.into_pull_request_comment("review_comment"))
                .collect(),
        }),
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
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> Option<FetchedDiscussion> {
    match fetch_paginated_github_items(
        http,
        access_token,
        |page| {
            format!(
                "/repos/{owner}/{repo}/pulls/{number}/reviews?per_page={METADATA_PAGE_SIZE}&page={page}"
            )
        },
        "pull request reviews",
        |reviews: Vec<GithubReviewResponse>| reviews,
    )
    .await
    {
        // Ids are collected before conversion: empty-body reviews (plain approvals) are dropped
        // from the comment list but their reviewers still count as participants.
        Ok(reviews) => Some(FetchedDiscussion {
            participant_ids: author_ids(&reviews, |review| review.user.as_ref()),
            reviews: latest_reviews(reviews.iter().filter_map(GithubReviewResponse::review)),
            comments: reviews
                .into_iter()
                .filter_map(GithubReviewResponse::into_pull_request_comment)
                .collect(),
        }),
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

fn author_ids<T>(
    items: &[T],
    user_of: impl Fn(&T) -> Option<&GithubUserResponse>,
) -> BTreeSet<u64> {
    items.iter().filter_map(|item| user_of(item)?.id).collect()
}

async fn fetch_check_runs(
    http: &GithubHttp,
    access_token: &str,
    owner: &str,
    repo: &str,
    head_sha: &str,
) -> Option<Vec<GithubPullRequestCheckRun>> {
    match fetch_paginated_github_items(
        http,
        access_token,
        |page| {
            format!(
                "/repos/{owner}/{repo}/commits/{head_sha}/check-runs?per_page={METADATA_PAGE_SIZE}&page={page}"
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
    http: &GithubHttp,
    access_token: &str,
    mut url_for_page: UrlForPage,
    description: &str,
    mut items_from_response: ItemsFromResponse,
) -> Result<Vec<Item>, GithubError>
where
    Response: DeserializeOwned,
    UrlForPage: FnMut(u32) -> String,
    ItemsFromResponse: FnMut(Response) -> Vec<Item>,
{
    let mut all_items = Vec::new();
    let mut page = 1;

    loop {
        let response =
            fetch_github_json::<Response>(http, access_token, url_for_page(page), description)
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
    http: &GithubHttp,
    access_token: &str,
    path: String,
    description: &str,
) -> Result<T, GithubError>
where
    T: DeserializeOwned,
{
    let response = http.send(GithubRequest::get(access_token, path)).await?;

    if !response.status.is_success() {
        return Err(unexpected(
            &response,
            &format!("failed to get {description}"),
        ));
    }

    response.json()
}

impl GithubOpenPullRequestResponse {
    fn into_enriched_pull_request(self, owner: &str, repo: &str) -> EnrichedGithubPullRequest {
        // The list endpoint does not include comments, so this is the partial structural
        // participant set; stored metadata merges participants as a union.
        let participant_ids = structural_participant_ids(
            self.user.as_ref(),
            &self.requested_reviewers,
            &self.assignees,
        );

        EnrichedGithubPullRequest {
            github_key: GithubKey::new(owner, repo, self.number).to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
            repository_id: self.base.repository_id(),
            number: self.number,
            url: self.html_url,
            display_name: format!("{owner}/{repo}#{}", self.number),
            name: Some(self.title),
            status: Some(GithubPullRequestStatus::Open),
            additions: None,
            deletions: None,
            author_login: self.user.as_ref().and_then(|user| user.login.clone()),
            author_id: self.user.as_ref().and_then(|user| user.id),
            description: self.body,
            comments: None,
            checks: None,
            participant_github_user_ids: (!participant_ids.is_empty())
                .then(|| participant_ids.iter().map(u64::to_string).collect()),
            draft: self.draft,
            requested_reviewer_github_user_ids: Some(user_ids(&self.requested_reviewers)),
            github_updated_at: self.updated_at,
            assignees: Some(pull_request_users(&self.assignees)),
            labels: Some(pull_request_labels(&self.labels)),
            reviews: None,
            base: self.base.git_ref(),
            head: self
                .head
                .as_ref()
                .map(GithubPullRequestHeadResponse::git_ref),
        }
    }
}

impl GithubCommentResponse {
    fn into_pull_request_comment(self, source: &str) -> GithubPullRequestComment {
        GithubPullRequestComment {
            id: self.id,
            body: self.body.unwrap_or_default(),
            author_id: self.user.as_ref().and_then(|user| user.id),
            author_login: self.user.and_then(|user| user.login),
            author_association: self.author_association,
            url: self.html_url,
            created_at: self.created_at,
            updated_at: self.updated_at,
            source: source.to_string(),
            in_reply_to_id: self.in_reply_to_id,
            pull_request_review_id: self.pull_request_review_id,
            path: self.path,
            line: self.line,
            original_line: self.original_line,
        }
    }
}

impl GithubReviewResponse {
    /// The review as its reviewer's state, when it was submitted by a user with an id.
    fn review(&self) -> Option<GithubPullRequestReview> {
        let user = self.user.as_ref()?;
        Some(GithubPullRequestReview {
            reviewer_github_user_id: user.id?.to_string(),
            reviewer_login: user.login.clone(),
            state: GithubPullRequestReviewState::from_github(self.state.as_deref()?)?,
            submitted_at: self.submitted_at,
        })
    }

    fn into_pull_request_comment(self) -> Option<GithubPullRequestComment> {
        let body = self.body.unwrap_or_default();

        if body.trim().is_empty() {
            return None;
        }

        Some(GithubPullRequestComment {
            id: self.id,
            body,
            author_id: self.user.as_ref().and_then(|user| user.id),
            author_login: self.user.and_then(|user| user.login),
            author_association: self.author_association,
            url: self.html_url,
            created_at: self.submitted_at,
            updated_at: None,
            source: "review".to_string(),
            in_reply_to_id: None,
            pull_request_review_id: None,
            path: None,
            line: None,
            original_line: None,
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
