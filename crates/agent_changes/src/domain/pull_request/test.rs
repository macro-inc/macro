use super::*;
use crate::domain::model::{ChangesetRange, GitRef};
use crate::domain::ports::PullRequestDiff;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

#[derive(Default)]
struct Reader {
    calls: Mutex<Vec<(String, PullRequestRef)>>,
    error: Option<fn() -> CompareError>,
    patch: Option<String>,
}

impl PullRequestDiffReader for Reader {
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        pr: &PullRequestRef,
    ) -> Result<PullRequestDiff, CompareError> {
        self.calls
            .lock()
            .unwrap()
            .push((user.to_string(), pr.clone()));
        if let Some(error) = self.error {
            return Err(error());
        }
        Ok(PullRequestDiff {
            patch: self.patch.clone().unwrap_or_else(|| "PR diff".to_owned()),
            range: ChangesetRange {
                repository: Some(pr.repository.https_url()),
                base: GitRef::named("release"),
                head: GitRef::named("fork-fix"),
            },
        })
    }
}

#[tokio::test]
async fn standalone_pr_uses_the_viewers_access_and_returns_matching_summary_and_patch() {
    let patch =
        "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-old\n+new\n+line\n";
    let service = PullRequestChanges::new(Reader {
        patch: Some(patch.to_owned()),
        ..Reader::default()
    });
    let session = test_agent_session(AgentSessionId::TEST_A);
    let viewer = session.owner_user().unwrap();
    let reference = PullRequestRef::parse("https://github.com/upstream/repo/pull/42").unwrap();
    let snapshot = service.changes(viewer, &reference).await.unwrap();
    assert_eq!(snapshot.patch.trim(), patch.trim());
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(snapshot.files[0].path, "a.txt");
    assert_eq!((snapshot.additions, snapshot.deletions), (2, 1));
    assert_eq!(snapshot.range.base.name.as_deref(), Some("release"));
    assert_eq!(snapshot.range.head.name.as_deref(), Some("fork-fix"));
    assert!(!snapshot.truncated);
    assert_eq!(
        *service.reader.calls.lock().unwrap(),
        vec![(viewer.to_string(), reference)]
    );
}

#[tokio::test]
async fn standalone_pr_preserves_repository_access_denials() {
    let service = PullRequestChanges::new(Reader {
        error: Some(|| CompareError::Unavailable),
        ..Reader::default()
    });
    let session = test_agent_session(AgentSessionId::TEST_A);
    let reference = PullRequestRef::parse("https://github.com/upstream/repo/pull/42").unwrap();
    assert!(matches!(
        service
            .changes(session.owner_user().unwrap(), &reference)
            .await,
        Err(CompareError::Unavailable)
    ));
}

#[tokio::test]
async fn standalone_pr_applies_the_same_per_file_budget_as_session_captures() {
    let service = PullRequestChanges::new(Reader {
        patch: Some(format!(
            "diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n@@ -0,0 +1 @@\n+{}\n",
            "a".repeat(MAX_FILE_PATCH_BYTES)
        )),
        ..Reader::default()
    });
    let session = test_agent_session(AgentSessionId::TEST_A);
    let reference = PullRequestRef::parse("https://github.com/upstream/repo/pull/42").unwrap();
    let snapshot = service
        .changes(session.owner_user().unwrap(), &reference)
        .await
        .unwrap();
    assert!(snapshot.truncated);
    assert!(snapshot.patch.is_empty());
    assert!(snapshot.files[0].patch_omitted);
    assert_eq!(snapshot.additions, 1);
}

#[tokio::test]
async fn every_harness_reads_the_linked_pr_with_the_session_owners_access() {
    let extractor = PullRequestChanges::new(Reader::default());
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
        let changes = extractor.extract(&session).await.unwrap();
        assert_eq!(changes.source, ChangesetSource::GithubPullRequest);
        assert_eq!(changes.patch, "PR diff");
        assert_eq!(
            changes.range.repository.as_deref(),
            Some("https://github.com/upstream/repo")
        );
        assert_eq!(changes.range.base.name.as_deref(), Some("release"));
        let calls = extractor.reader.calls.lock().unwrap();
        let (user, pr) = calls.last().unwrap();
        assert_eq!(user, &session.owner_id.to_string());
        assert_eq!(pr.number.get(), 42);
    }
}

#[tokio::test]
async fn missing_or_invalid_pr_never_falls_back_to_a_branch_or_runtime() {
    let extractor = PullRequestChanges::new(Reader::default());
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
    assert!(extractor.reader.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn inaccessible_and_oversized_prs_remain_unavailable_without_a_fallback() {
    for error in [
        || CompareError::NotFound,
        || CompareError::Unavailable,
        || CompareError::TooLarge,
    ] {
        let extractor = PullRequestChanges::new(Reader {
            error: Some(error),
            ..Reader::default()
        });
        let mut session = test_agent_session(AgentSessionId::TEST_A);
        session.pull_request_url = Some("https://github.com/o/r/pull/1".to_owned());
        assert!(matches!(
            extractor.extract(&session).await,
            Err(ExtractError::NotReady(_))
        ));
        assert_eq!(extractor.reader.calls.lock().unwrap().len(), 1);
    }
}
