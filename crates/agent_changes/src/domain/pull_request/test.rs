use super::*;
use crate::domain::model::{ChangesetRange, GitRef, GithubPullRequestChangeset};
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

#[derive(Default)]
struct Changesets {
    calls: Mutex<Vec<(String, PullRequestRef)>>,
    capture_error: Option<fn() -> GithubPullRequestChangesError>,
    patch_error: Option<fn() -> GithubPullRequestChangesError>,
}

impl GithubPullRequestChangesets for Changesets {
    async fn changeset(
        &self,
        _id: Uuid,
    ) -> Result<Option<GithubPullRequestChangeset>, GithubPullRequestChangesError> {
        Ok(None)
    }

    async fn capture(
        &self,
        user: &MacroUserIdStr<'static>,
        pr: &PullRequestRef,
    ) -> Result<GithubPullRequestChangeset, GithubPullRequestChangesError> {
        self.calls
            .lock()
            .unwrap()
            .push((user.to_string(), pr.clone()));
        if let Some(error) = self.capture_error {
            return Err(error());
        }
        Ok(GithubPullRequestChangeset {
            id: Uuid::nil(),
            github_key: "github:1:42".to_owned(),
            pull_request: pr.clone(),
            range: ChangesetRange {
                repository: Some(pr.repository.https_url()),
                base: GitRef::named("release"),
                head: GitRef::named("fork-fix"),
            },
            files: Vec::new(),
            additions: 0,
            deletions: 0,
            patch_bytes: 0,
            truncated: false,
            patch_key: None,
            captured_at: Utc::now(),
        })
    }

    async fn patch(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<String, GithubPullRequestChangesError> {
        if let Some(error) = self.patch_error {
            return Err(error());
        }
        Ok(format!("patch {id} for {user}"))
    }
}

fn linked_session() -> AgentSession {
    let mut session = test_agent_session(AgentSessionId::TEST_A);
    session.pull_request_url = Some("https://github.com/o/r/pull/1".to_owned());
    session
}

#[tokio::test]
async fn every_harness_reads_the_linked_pr_with_the_session_owners_access() {
    let extractor = PullRequestChanges::new(Changesets::default());
    for harness in [
        "cursor",
        "macrod",
        "opencode",
        "codex-cloud",
        "claude-cloud",
        "macro-inmem",
    ] {
        let mut session = test_agent_session(AgentSessionId::TEST_A);
        session.harness = harness.to_owned();
        session.pull_request_url = Some("https://github.com/upstream/repo/pull/42".to_owned());
        session.repo_url = Some("https://github.com/other/repo".to_owned());
        let ExtractedChangeset::PullRequest(changes) = extractor.extract(&session).await.unwrap()
        else {
            panic!("expected the pull request's shared changeset");
        };
        assert_eq!(
            changes.range.repository.as_deref(),
            Some("https://github.com/upstream/repo")
        );
        assert_eq!(changes.range.base.name.as_deref(), Some("release"));
        let calls = extractor.changesets.calls.lock().unwrap();
        let (user, pr) = calls.last().unwrap();
        assert_eq!(user, &session.owner_id.to_string());
        assert_eq!(pr.number.get(), 42);
    }
}

#[tokio::test]
async fn missing_or_invalid_pr_never_falls_back_to_a_branch_or_runtime() {
    let extractor = PullRequestChanges::new(Changesets::default());
    for url in [
        None,
        Some("https://github.com/o/r/tree/work"),
        Some("https://evil.example/o/r/pull/1"),
    ] {
        let mut session = test_agent_session(AgentSessionId::TEST_A);
        session.pull_request_url = url.map(str::to_owned);
        assert!(matches!(
            extractor.extract(&session).await,
            Err(ExtractError::NotReady(_))
        ));
    }
    assert!(extractor.changesets.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn inaccessible_and_oversized_prs_remain_unavailable_without_a_fallback() {
    for error in [
        || GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::NotFound),
        || GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::Unavailable),
        || GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::TooLarge),
    ] {
        let extractor = PullRequestChanges::new(Changesets {
            capture_error: Some(error),
            ..Changesets::default()
        });
        assert!(matches!(
            extractor.extract(&linked_session()).await,
            Err(ExtractError::NotReady(_))
        ));
        assert_eq!(extractor.changesets.calls.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn a_storage_failure_is_a_failed_capture() {
    let extractor = PullRequestChanges::new(Changesets {
        capture_error: Some(|| {
            GithubPullRequestChangesError::Storage(anyhow::anyhow!("database unavailable"))
        }),
        ..Changesets::default()
    });
    assert!(matches!(
        extractor.extract(&linked_session()).await,
        Err(ExtractError::Failed(_))
    ));
}

#[tokio::test]
async fn the_shared_patch_is_read_with_the_session_owners_access() {
    let extractor = PullRequestChanges::new(Changesets::default());
    let session = linked_session();
    let patch = extractor
        .pull_request_patch(&session, Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        patch,
        Some(format!("patch {} for {}", Uuid::nil(), session.owner_id))
    );
}

#[tokio::test]
async fn a_shared_patch_the_pull_request_moved_past_is_gone() {
    for error in [
        || GithubPullRequestChangesError::Moved,
        || GithubPullRequestChangesError::NotFound,
        || GithubPullRequestChangesError::Diff(GithubPullRequestDiffError::Unavailable),
    ] {
        let extractor = PullRequestChanges::new(Changesets {
            patch_error: Some(error),
            ..Changesets::default()
        });
        assert_eq!(
            extractor
                .pull_request_patch(&linked_session(), Uuid::nil())
                .await
                .unwrap(),
            None
        );
    }
}
