use super::*;
use agent_changes::domain::model::{ChangesetRange, ChangesetSource};
use agent_changes::testing::ScriptedExtractor;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;

fn extracted(source: ChangesetSource) -> ExtractedChangeset {
    ExtractedChangeset {
        source,
        range: ChangesetRange::default(),
        patch: String::new(),
        truncated: false,
    }
}

fn router() -> RoutedChangesetExtractor<ScriptedExtractor, ScriptedExtractor> {
    RoutedChangesetExtractor::new(
        ScriptedExtractor::returning(extracted(ChangesetSource::CursorGithubCompare)),
        ScriptedExtractor::returning(extracted(ChangesetSource::MacrodGit)),
    )
}

#[tokio::test]
async fn cursor_sessions_go_to_the_cursor_extractor() {
    let mut session = test_agent_session(AgentSessionId::TEST_A);
    session.bot_id = bot_id::CURSOR_BOT_ID;
    session.harness = "cursor".to_owned();
    let changeset = router().extract(&session).await.unwrap();
    assert_eq!(changeset.source, ChangesetSource::CursorGithubCompare);
}

#[tokio::test]
async fn external_sessions_go_to_the_macrod_extractor() {
    let mut session = test_agent_session(AgentSessionId::TEST_A);
    session.harness = harness_id::MACROD_HARNESS_SLUG.to_owned();
    let changeset = router().extract(&session).await.unwrap();
    assert_eq!(changeset.source, ChangesetSource::MacrodGit);
}

#[tokio::test]
async fn managed_sandboxes_and_the_in_process_agent_are_unsupported() {
    let mut sandbox = test_agent_session(AgentSessionId::TEST_A);
    sandbox.bot_id = bot_id::MACRO_CODER_BOT_ID;
    sandbox.harness = "opencode".to_owned();
    assert!(matches!(
        router().extract(&sandbox).await,
        Err(ExtractError::Unsupported { harness }) if harness == "opencode"
    ));

    let mut inmem = test_agent_session(AgentSessionId::TEST_A);
    inmem.harness = "macro-inmem".to_owned();
    assert!(matches!(
        router().extract(&inmem).await,
        Err(ExtractError::Unsupported { .. })
    ));
}
