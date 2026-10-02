//! Complete immutable GitHub file pairs for agents without a connected workspace.
use agent_changes::domain::model::PullRequestRef;
use agent_review::domain::{
    model::{Capture, Comparison, Result, ReviewError, SourceKind},
    ports::ReviewSource,
};
use agent_session::domain::model::AgentSession;
use async_trait::async_trait;
use diffd_core::{
    build::FileInput,
    model::{FileStatus, Omitted},
};
use futures::{StreamExt, TryStreamExt};
use github::domain::{
    ports::{GithubSyncClient, GithubSyncRepo},
    service::InstallationTokenService,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

pub(crate) struct GithubReviews<R, C> {
    tokens: InstallationTokenService<R, C>,
    http: reqwest::Client,
}
impl<R: GithubSyncRepo, C: GithubSyncClient> GithubReviews<R, C> {
    pub(crate) fn new(tokens: InstallationTokenService<R, C>) -> Self {
        Self {
            tokens,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("GitHub review HTTP client"),
        }
    }
    async fn get(
        &self,
        path: &str,
        token: &str,
        limit: usize,
        raw: bool,
    ) -> Result<Option<Vec<u8>>> {
        let mut response = self
            .http
            .get(format!("https://api.github.com{path}"))
            .bearer_auth(token)
            .header("User-Agent", "Macro-Agent-Review")
            .header(
                "Accept",
                if raw {
                    "application/vnd.github.raw+json"
                } else {
                    "application/vnd.github+json"
                },
            )
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?;
        if !response.status().is_success() {
            return Err(ReviewError::Unavailable(format!(
                "GitHub could not read this comparison ({})",
                response.status()
            )));
        }
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
        {
            if bytes.len() + chunk.len() > limit {
                return Ok(None);
            }
            bytes.extend(chunk);
        }
        Ok(Some(bytes))
    }
    async fn json<T: serde::de::DeserializeOwned>(&self, path: &str, token: &str) -> Result<T> {
        let bytes = self
            .get(path, token, 8 * 1024 * 1024, false)
            .await?
            .ok_or_else(|| {
                ReviewError::Unavailable("GitHub metadata exceeded the review budget".into())
            })?;
        serde_json::from_slice(&bytes)
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))
    }
    async fn contents(
        &self,
        repo: &str,
        path: &str,
        sha: &str,
        token: &str,
    ) -> Result<Option<Vec<u8>>> {
        let mut url = url::Url::parse("https://api.github.com").expect("static URL");
        url.path_segments_mut()
            .expect("hierarchical URL")
            .extend(["repos"])
            .extend(repo.split('/'))
            .push("contents")
            .extend(path.split('/'));
        url.query_pairs_mut().append_pair("ref", sha);
        self.get(
            &format!("{}?{}", url.path(), url.query().unwrap_or_default()),
            token,
            8 * 1024 * 1024,
            true,
        )
        .await
    }
}
#[derive(Deserialize, PartialEq)]
struct Branch {
    sha: String,
}
#[derive(Deserialize, PartialEq)]
struct Metadata {
    base: Branch,
    head: Branch,
}
#[derive(Deserialize)]
struct Compared {
    merge_base_commit: Commit,
    #[serde(default)]
    files: Vec<Changed>,
}
#[derive(Deserialize)]
struct Commit {
    sha: String,
}
#[derive(Deserialize)]
struct Changed {
    filename: String,
    previous_filename: Option<String>,
    status: String,
}

#[async_trait]
impl<R: GithubSyncRepo, C: GithubSyncClient> ReviewSource for GithubReviews<R, C> {
    async fn capture(&self, session: &AgentSession, comparison: &Comparison) -> Result<Capture> {
        let pr = session
            .pull_request_url
            .as_deref()
            .and_then(PullRequestRef::parse)
            .ok_or(ReviewError::NotFound)?;
        let user_string = session.owner_id.to_string();
        let user =
            MacroUserIdStr::parse_from_str(&user_string).map_err(|_| ReviewError::Forbidden)?;
        let token = self
            .tokens
            .for_repository(
                &user,
                &pr.repository.owner,
                &pr.repository.name,
                &[("pull_requests", "read"), ("contents", "read")],
            )
            .await
            .map_err(|_| {
                ReviewError::Unavailable(
                    "Connect GitHub with access to this repository to review its pull request"
                        .into(),
                )
            })?;
        let repo = format!("{}/{}", pr.repository.owner, pr.repository.name);
        let endpoint = format!("/repos/{repo}/pulls/{}", pr.number);
        let metadata: Metadata = self.json(&endpoint, &token.token).await?;
        let mut compared: Compared = self
            .json(
                &format!(
                    "/repos/{repo}/compare/{}...{}",
                    metadata.base.sha, metadata.head.sha
                ),
                &token.token,
            )
            .await?;
        // The files endpoint is defined by the PR's merge base. Never label those files
        // as a different user-supplied comparison.
        if comparison
            .head
            .as_ref()
            .is_some_and(|head| head != &metadata.head.sha)
        {
            return Err(ReviewError::Invalid(
                "A PR-backed review follows the linked pull request's current head".into(),
            ));
        }
        let mut changes = Vec::new();
        if let Some(base) = comparison
            .base
            .as_deref()
            .filter(|base| *base != compared.merge_base_commit.sha)
        {
            if !base.bytes().all(|b| b.is_ascii_hexdigit()) || base.len() != 40 {
                return Err(ReviewError::Invalid(
                    "PR-backed comparisons require a full immutable base SHA".into(),
                ));
            }
            compared = self
                .json(
                    &format!("/repos/{repo}/compare/{base}...{}", metadata.head.sha),
                    &token.token,
                )
                .await?;
            if compared.merge_base_commit.sha != base {
                return Err(ReviewError::Invalid(
                    "The requested PR base is not an ancestor of its head".into(),
                ));
            }
            if compared.files.len() >= 300 {
                return Err(ReviewError::Unavailable("GitHub limits custom comparisons to 300 files. Use the current PR base or a connected workspace".into()));
            }
            changes = std::mem::take(&mut compared.files);
        } else {
            for page in 1..=30 {
                let files: Vec<Changed> = self
                    .json(
                        &format!("{endpoint}/files?per_page=100&page={page}"),
                        &token.token,
                    )
                    .await?;
                let done = files.len() < 100;
                changes.extend(files);
                if done {
                    break;
                }
                if page == 30 {
                    return Err(ReviewError::Unavailable("GitHub limits PR file listings to 3,000 files. Use a connected workspace for this review".into()));
                }
            }
        }
        let total = AtomicUsize::new(0);
        let inputs: Vec<FileInput> = futures::stream::iter(changes)
            .map(|change| {
                let repo = &repo;
                let token = &token.token;
                let base = &compared.merge_base_commit.sha;
                let head = &metadata.head.sha;
                let total = &total;
                async move {
                    let status = match change.status.as_str() {
                        "added" => FileStatus::Added,
                        "removed" => FileStatus::Deleted,
                        "renamed" => FileStatus::Renamed,
                        _ => FileStatus::Modified,
                    };
                    let mut input = FileInput {
                        path: change.filename.clone(),
                        old_path: change.previous_filename.clone(),
                        status,
                        old: None,
                        new: None,
                        omitted: None,
                        details: vec![],
                        collapsed: None,
                    };
                    if total.load(Ordering::Relaxed) >= 64 * 1024 * 1024 {
                        input.omitted = Some(Omitted::TooLarge);
                        return Ok(input);
                    }
                    let old = if status == FileStatus::Added {
                        Some(vec![])
                    } else {
                        self.contents(
                            repo,
                            change
                                .previous_filename
                                .as_deref()
                                .unwrap_or(&change.filename),
                            base,
                            token,
                        )
                        .await?
                    };
                    let new = if status == FileStatus::Deleted {
                        Some(vec![])
                    } else {
                        self.contents(repo, &change.filename, head, token).await?
                    };
                    let (Some(old), Some(new)) = (old, new) else {
                        input.omitted = Some(Omitted::TooLarge);
                        return Ok(input);
                    };
                    let size = old.len() + new.len();
                    if total.fetch_add(size, Ordering::Relaxed) + size > 64 * 1024 * 1024 {
                        input.omitted = Some(Omitted::TooLarge);
                        return Ok(input);
                    }
                    if old.contains(&0) || new.contains(&0) {
                        input.omitted = Some(Omitted::Binary);
                        return Ok(input);
                    }
                    match (String::from_utf8(old), String::from_utf8(new)) {
                        (Ok(old), Ok(new)) => {
                            if status != FileStatus::Added {
                                input.old = Some(old);
                            }
                            if status != FileStatus::Deleted {
                                input.new = Some(new);
                            }
                        }
                        _ => input.omitted = Some(Omitted::Binary),
                    }
                    Ok::<_, ReviewError>(input)
                }
            })
            .buffered(8)
            .try_collect()
            .await?;
        if self.json::<Metadata>(&endpoint, &token.token).await? != metadata {
            return Err(ReviewError::Conflict);
        }
        let snapshot = tokio::task::spawn_blocking(move || agent_review_runtime::build(inputs))
            .await
            .map_err(|e| ReviewError::Infrastructure(rootcause::report!(e).into()))?
            .map_err(ReviewError::Unavailable)?;
        Ok(Capture {
            comparison: Comparison {
                worktree: false,
                base: Some(compared.merge_base_commit.sha),
                head: Some(metadata.head.sha),
            },
            repository: repo,
            source: SourceKind::PullRequest,
            snapshot,
        })
    }
}
