use super::*;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use bot_id::BotId;
use harness_id::HarnessId;

struct Bound(Option<HarnessId>);

impl HarnessBindings for Bound {
    async fn harness_for(&self, _bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        Ok(self.0)
    }
}

struct Answer(Result<CollectChangesResult, fn() -> CollectChangesError>);

impl HarnessChanges for Answer {
    async fn collect_changes(
        &self,
        _harness: HarnessId,
    ) -> Result<CollectChangesResult, CollectChangesError> {
        match &self.0 {
            Ok(result) => Ok(result.clone()),
            Err(fail) => Err(fail()),
        }
    }
}

fn collected(repository: Option<&str>) -> CollectChangesResult {
    CollectChangesResult::Collected {
        patch: "diff --git a/f b/f\n".to_owned(),
        repository: repository.map(str::to_owned),
        base: ChangesRef {
            name: Some("main".to_owned()),
            sha: Some("aaa".to_owned()),
        },
        head: ChangesRef {
            name: Some("agent/work".to_owned()),
            sha: Some("bbb".to_owned()),
        },
        truncated: true,
    }
}

#[tokio::test]
async fn the_daemons_answer_becomes_the_changeset() {
    let extractor = MacrodChangesetExtractor::new(
        Bound(Some(HarnessId::TEST_A)),
        Answer(Ok(collected(Some("git@github.com:macro-inc/macro.git")))),
    );
    let session = test_agent_session(AgentSessionId::TEST_A);
    let changeset = extractor.extract(&session).await.unwrap();
    assert_eq!(changeset.source, ChangesetSource::MacrodGit);
    assert_eq!(
        changeset.range.repository.as_deref(),
        Some("https://github.com/macro-inc/macro")
    );
    assert_eq!(changeset.range.base.sha.as_deref(), Some("aaa"));
    assert_eq!(changeset.range.head.name.as_deref(), Some("agent/work"));
    assert!(changeset.truncated);
}

#[tokio::test]
async fn a_non_github_remote_is_kept_as_is() {
    let extractor = MacrodChangesetExtractor::new(
        Bound(Some(HarnessId::TEST_A)),
        Answer(Ok(collected(Some("https://gitlab.com/o/r.git")))),
    );
    let session = test_agent_session(AgentSessionId::TEST_A);
    let changeset = extractor.extract(&session).await.unwrap();
    assert_eq!(
        changeset.range.repository.as_deref(),
        Some("https://gitlab.com/o/r.git")
    );
}

#[tokio::test]
async fn an_unbound_bot_and_a_disconnected_daemon_are_not_ready() {
    let session = test_agent_session(AgentSessionId::TEST_A);
    let unbound = MacrodChangesetExtractor::new(Bound(None), Answer(Ok(collected(None))));
    assert!(matches!(
        unbound.extract(&session).await,
        Err(ExtractError::NotReady(reason)) if reason.contains("not bound")
    ));

    let disconnected = MacrodChangesetExtractor::new(
        Bound(Some(HarnessId::TEST_A)),
        Answer(Err(|| CollectChangesError::NotConnected)),
    );
    assert!(matches!(
        disconnected.extract(&session).await,
        Err(ExtractError::NotReady(reason)) if reason.contains("not connected")
    ));

    let slow = MacrodChangesetExtractor::new(
        Bound(Some(HarnessId::TEST_A)),
        Answer(Err(|| CollectChangesError::TimedOut)),
    );
    assert!(matches!(
        slow.extract(&session).await,
        Err(ExtractError::NotReady(reason)) if reason.contains("too long")
    ));
}

#[tokio::test]
async fn the_daemons_own_error_is_shown_to_the_user() {
    let extractor = MacrodChangesetExtractor::new(
        Bound(Some(HarnessId::TEST_A)),
        Answer(Ok(CollectChangesResult::Error {
            message: "The workspace is not a git repository.".to_owned(),
        })),
    );
    let session = test_agent_session(AgentSessionId::TEST_A);
    assert!(matches!(
        extractor.extract(&session).await,
        Err(ExtractError::NotReady(reason)) if reason == "The workspace is not a git repository."
    ));
}
