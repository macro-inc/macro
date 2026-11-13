//! [`GithubApi`] on GitHub's REST API (commits, pull requests) and GraphQL
//! API (blame, which REST does not offer). Requests are unauthenticated
//! unless a token is configured: 60 REST requests an hour per IP instead of
//! 5,000, and no blame. Answers are cached by the read service, so the
//! unauthenticated budget covers light use.

use std::time::Duration;

use chrono::Utc;
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue, RETRY_AFTER, USER_AGENT};
use reqwest::{Response, StatusCode};
use serde::Deserialize;
use serde_json::json;
use upstream_error::{UpstreamError, UpstreamFailure};

use crate::domain::read::models::{BlameHunk, GithubBlame, GithubCommit, GithubPullRequest};
use crate::domain::read::ports::{GithubApi, GithubError};

#[cfg(test)]
mod test;

const SERVICE: &str = "GitHub";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CLIENT_USER_AGENT: &str = "macro-gitai-service";
const API_VERSION_HEADER: &str = "x-github-api-version";
const API_VERSION: &str = "2022-11-28";
const RATE_LIMIT_REMAINING_HEADER: &str = "x-ratelimit-remaining";
const RATE_LIMIT_RESET_HEADER: &str = "x-ratelimit-reset";
/// Page size of the pull request commits list (GitHub's maximum).
const COMMITS_PAGE_SIZE: usize = 100;
/// GitHub lists at most 250 commits of a pull request: three pages.
const MAX_COMMIT_PAGES: usize = 3;

/// Blame of one file at one revision, with the revision's commit.
const BLAME_QUERY: &str = "query($owner: String!, $name: String!, $rev: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $rev) {
      ... on Commit {
        oid
        blame(path: $path) { ranges { startingLine endingLine commit { oid } } }
      }
    }
  }
}";

/// A GitHub API client for one repository.
pub struct GithubClient {
    http: reqwest::Client,
    base_url: String,
    token: Option<String>,
    owner: String,
    name: String,
}

/// The client could not be built.
#[derive(Debug, thiserror::Error)]
pub enum GithubClientError {
    /// The HTTP client failed to build.
    #[error("could not build the GitHub HTTP client: {0}")]
    Build(#[from] reqwest::Error),
    /// The repository is not `owner/name`.
    #[error("the GitHub repository is not owner/name")]
    Repository,
}

#[derive(Deserialize)]
struct CommitBody {
    sha: String,
    commit: CommitDetails,
}

#[derive(Deserialize)]
struct CommitDetails {
    message: String,
}

#[derive(Deserialize)]
struct PullRequestBody {
    number: u64,
    state: String,
}

#[derive(Deserialize)]
struct PullRequestCommitBody {
    sha: String,
}

#[derive(Deserialize)]
struct GraphqlBody {
    data: Option<GraphqlData>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Deserialize)]
struct GraphqlError {
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct GraphqlData {
    repository: Option<GraphqlRepository>,
}

#[derive(Deserialize)]
struct GraphqlRepository {
    object: Option<GraphqlCommit>,
}

#[derive(Deserialize)]
struct GraphqlCommit {
    oid: Option<String>,
    blame: Option<GraphqlBlame>,
}

#[derive(Deserialize)]
struct GraphqlBlame {
    ranges: Vec<GraphqlRange>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlRange {
    starting_line: u32,
    ending_line: u32,
    commit: GraphqlOid,
}

#[derive(Deserialize)]
struct GraphqlOid {
    oid: String,
}

fn upstream(failure: UpstreamFailure) -> GithubError {
    GithubError::Upstream(UpstreamError {
        service: SERVICE,
        failure,
    })
}

fn transport(error: &reqwest::Error) -> GithubError {
    upstream(UpstreamFailure::from_transport(error))
}

/// How long until GitHub's rate limit window resets, from its headers.
fn rate_limit_wait(headers: &HeaderMap) -> Option<Duration> {
    if let Some(wait) = upstream_error::retry_after(headers) {
        return Some(wait);
    }
    let reset: i64 = headers
        .get(RATE_LIMIT_RESET_HEADER)?
        .to_str()
        .ok()?
        .parse()
        .ok()?;
    let seconds = u64::try_from(reset - Utc::now().timestamp()).ok()?;
    Some(Duration::from_secs(seconds))
}

/// Sorts a response: `None` for not found, an error for GitHub's failures.
/// GitHub signals an exhausted rate limit with 403 or 429 and
/// `x-ratelimit-remaining: 0`, or 429 and `retry-after` for secondary limits.
fn classify(response: Response) -> Result<Option<Response>, GithubError> {
    let status = response.status();
    let headers = response.headers();

    let exhausted = headers
        .get(RATE_LIMIT_REMAINING_HEADER)
        .is_some_and(|remaining| remaining == "0");
    let throttled = status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN && (exhausted || headers.contains_key(RETRY_AFTER)));
    if throttled {
        return Err(upstream(UpstreamFailure::RateLimited {
            retry_after: rate_limit_wait(headers),
        }));
    }

    // 422 is GitHub's answer to a SHA it cannot resolve.
    if status == StatusCode::NOT_FOUND || status == StatusCode::UNPROCESSABLE_ENTITY {
        return Ok(None);
    }
    if let Some(failure) = UpstreamFailure::from_status(status, headers) {
        return Err(upstream(failure));
    }
    // Any other 4xx (a bad or expired token) is not something a retry fixes.
    if !status.is_success() {
        return Err(upstream(UpstreamFailure::InvalidResponse));
    }
    Ok(Some(response))
}

impl GithubClient {
    /// A client for `repository` (`owner/name`) at `base_url` (GitHub's
    /// `GithubApiUrl`, or a fake in tests), authenticated when `token` is
    /// given.
    pub fn new(
        base_url: &str,
        token: Option<String>,
        repository: &str,
    ) -> Result<Self, GithubClientError> {
        let (owner, name) = repository
            .split_once('/')
            .ok_or(GithubClientError::Repository)?;

        let mut headers = HeaderMap::new();
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(API_VERSION_HEADER, HeaderValue::from_static(API_VERSION));
        headers.insert(USER_AGENT, HeaderValue::from_static(CLIENT_USER_AGENT));
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .default_headers(headers)
            .build()?;

        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_owned(),
            token,
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    fn request(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let mut headers = HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let builder = builder.headers(headers);
        match &self.token {
            Some(token) => builder.bearer_auth(token),
            None => builder,
        }
    }

    /// GETs a path under the repository; `None` for not found.
    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<Option<T>, GithubError> {
        let url = format!("{}/repos/{}/{}{path}", self.base_url, self.owner, self.name);
        let response = self
            .request(self.http.get(url))
            .send()
            .await
            .map_err(|error| transport(&error))?;
        let Some(response) = classify(response)? else {
            return Ok(None);
        };
        let body = response.json().await.map_err(|error| transport(&error))?;
        Ok(Some(body))
    }
}

impl GithubApi for GithubClient {
    #[tracing::instrument(name = "gitai.github.commit", skip(self), err)]
    async fn commit(&self, sha: &str) -> Result<Option<GithubCommit>, GithubError> {
        let body: Option<CommitBody> = self.get_json(&format!("/commits/{sha}")).await?;
        Ok(body.map(|body| GithubCommit {
            sha: body.sha,
            subject: body
                .commit
                .message
                .lines()
                .next()
                .unwrap_or_default()
                .to_owned(),
        }))
    }

    #[tracing::instrument(name = "gitai.github.pull_request", skip(self), err)]
    async fn pull_request(&self, number: u64) -> Result<Option<GithubPullRequest>, GithubError> {
        let body: Option<PullRequestBody> = self.get_json(&format!("/pulls/{number}")).await?;
        Ok(body.map(|body| GithubPullRequest {
            number: body.number,
            open: body.state == "open",
        }))
    }

    #[tracing::instrument(name = "gitai.github.pull_request_commits", skip(self), fields(commits = tracing::field::Empty), err)]
    async fn pull_request_commits(&self, number: u64) -> Result<Vec<String>, GithubError> {
        let mut commits = Vec::new();
        for page in 1..=MAX_COMMIT_PAGES {
            let path = format!("/pulls/{number}/commits?per_page={COMMITS_PAGE_SIZE}&page={page}");
            let body: Vec<PullRequestCommitBody> = self.get_json(&path).await?.unwrap_or_default();
            let full_page = body.len() == COMMITS_PAGE_SIZE;
            commits.extend(body.into_iter().map(|commit| commit.sha));
            if !full_page {
                break;
            }
        }
        tracing::Span::current().record("commits", commits.len());
        Ok(commits)
    }

    #[tracing::instrument(name = "gitai.github.blame", skip(self, path), err)]
    async fn blame(&self, rev: &str, path: &str) -> Result<Option<GithubBlame>, GithubError> {
        if self.token.is_none() {
            return Err(GithubError::BlameNeedsToken);
        }
        let body = json!({
            "query": BLAME_QUERY,
            "variables": { "owner": self.owner, "name": self.name, "rev": rev, "path": path },
        });
        let response = self
            .request(self.http.post(format!("{}/graphql", self.base_url)))
            .json(&body)
            .send()
            .await
            .map_err(|error| transport(&error))?;
        let Some(response) = classify(response)? else {
            return Ok(None);
        };
        let body: GraphqlBody = response.json().await.map_err(|error| transport(&error))?;

        if let Some(error) = body.errors.first() {
            return match error.kind.as_deref() {
                Some("NOT_FOUND") => Ok(None),
                Some("RATE_LIMITED") => {
                    Err(upstream(UpstreamFailure::RateLimited { retry_after: None }))
                }
                _ => Err(upstream(UpstreamFailure::InvalidResponse)),
            };
        }

        // An unknown revision gives a null object; a path missing at it, or
        // a revision that is not a commit, gives no blame.
        let commit = body
            .data
            .and_then(|data| data.repository)
            .and_then(|repository| repository.object);
        let Some(GraphqlCommit {
            oid: Some(oid),
            blame: Some(blame),
        }) = commit
        else {
            return Ok(None);
        };
        Ok(Some(GithubBlame {
            commit: oid,
            hunks: blame
                .ranges
                .into_iter()
                .map(|range| BlameHunk {
                    start: range.starting_line,
                    end: range.ending_line,
                    commit: range.commit.oid,
                })
                .collect(),
        }))
    }
}
