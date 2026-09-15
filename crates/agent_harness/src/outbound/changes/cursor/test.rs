use std::sync::Mutex;

use super::*;
use agent_changes::domain::ports::RepositoryComparison;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use cursor_cloud_agents::domain::event::GitBranch;
use macro_user_id::user_id::MacroUserIdStr;

struct Branches(Option<GitBranch>);

impl PushedBranches for Branches {
    async fn latest_pushed_branch(
        &self,
        _agent_session_id: macro_uuid::Uuid,
    ) -> Result<Option<GitBranch>, rootcause::Report> {
        Ok(self.0.clone())
    }
}

#[derive(Default)]
struct Compare {
    compared: Mutex<Vec<(String, String, String)>>,
    fail_with: Option<fn() -> CompareError>,
}

impl RepositoryCompare for Compare {
    async fn default_branch(
        &self,
        _user: &MacroUserIdStr<'static>,
        _repository: &RepositorySlug,
    ) -> Result<String, CompareError> {
        Ok("main".to_owned())
    }

    async fn compare(
        &self,
        _user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
        base: &str,
        head: &str,
    ) -> Result<RepositoryComparison, CompareError> {
        if let Some(fail) = self.fail_with {
            return Err(fail());
        }
        self.compared.lock().unwrap().push((
            repository.to_string(),
            base.to_owned(),
            head.to_owned(),
        ));
        Ok(RepositoryComparison {
            patch: "diff --git a/f b/f\n".to_owned(),
            base_sha: Some("base".to_owned()),
            head_sha: Some("head".to_owned()),
        })
    }
}

fn pushed(branch: Option<&str>) -> GitBranch {
    GitBranch {
        repo_url: "github.com/macro-inc/macro".to_owned(),
        branch: branch.map(str::to_owned),
        pr_url: None,
    }
}

#[tokio::test]
async fn the_pushed_branch_is_compared_against_the_default_branch() {
    let extractor = CursorChangesetExtractor::new(
        Branches(Some(pushed(Some("cursor/fix")))),
        Compare::default(),
    );
    let session = test_agent_session(AgentSessionId::TEST_A);
    let changeset = extractor.extract(&session).await.unwrap();
    assert_eq!(changeset.source, ChangesetSource::CursorGithubCompare);
    assert_eq!(
        changeset.range.repository.as_deref(),
        Some("https://github.com/macro-inc/macro")
    );
    assert_eq!(changeset.range.base.name.as_deref(), Some("main"));
    assert_eq!(changeset.range.base.sha.as_deref(), Some("base"));
    assert_eq!(changeset.range.head.name.as_deref(), Some("cursor/fix"));
    assert_eq!(changeset.range.head.sha.as_deref(), Some("head"));
    assert!(changeset.patch.starts_with("diff --git"));
    assert_eq!(
        extractor.compare.compared.lock().unwrap().as_slice(),
        &[(
            "macro-inc/macro".to_owned(),
            "main".to_owned(),
            "cursor/fix".to_owned()
        )]
    );
}

#[tokio::test]
async fn no_pushed_branch_is_not_ready_rather_than_failed() {
    let session = test_agent_session(AgentSessionId::TEST_A);
    for branches in [Branches(None), Branches(Some(pushed(None)))] {
        let extractor = CursorChangesetExtractor::new(branches, Compare::default());
        assert!(matches!(
            extractor.extract(&session).await,
            Err(ExtractError::NotReady(reason)) if reason.contains("not pushed")
        ));
    }
}

#[tokio::test]
async fn compare_failures_become_words_for_the_pane() {
    let session = test_agent_session(AgentSessionId::TEST_A);
    let cases: [(fn() -> CompareError, &str); 3] = [
        (|| CompareError::NotFound, "not on GitHub yet"),
        (|| CompareError::TooLarge, "too large"),
        (|| CompareError::Unavailable, "GitHub App"),
    ];
    for (fail, expected) in cases {
        let extractor = CursorChangesetExtractor::new(
            Branches(Some(pushed(Some("b")))),
            Compare {
                fail_with: Some(fail),
                ..Compare::default()
            },
        );
        match extractor.extract(&session).await {
            Err(ExtractError::NotReady(reason)) => assert!(reason.contains(expected), "{reason}"),
            other => panic!("expected not ready, got {other:?}"),
        }
    }
}
