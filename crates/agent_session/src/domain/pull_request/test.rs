use super::*;
use crate::domain::{model::Message, ports::AgentSessionLogRepo};
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

#[test]
fn normalizes_pr_urls_and_rejects_non_pr_destinations() {
    assert_eq!(
        canonical_url("https://github.com/org/repo/pull/001/#discussion").unwrap(),
        "https://github.com/org/repo/pull/1"
    );
    for invalid in [
        "javascript:alert(1)",
        "http://github.com/org/repo/pull/1",
        "https://evil.com/org/repo/pull/1",
        "https://user@github.com/org/repo/pull/1",
        "https://github.com/org/repo/issues/1",
        "https://github.com/org/repo/pull/0",
        "https://github.com/org/repo/pull/1/files",
    ] {
        assert!(canonical_url(invalid).is_err(), "{invalid}");
    }
}

#[tokio::test]
async fn persists_and_publishes_once_and_rejects_another_owner() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    let realtime = RecordingRealtime::new();
    let service = SessionPullRequestService::new(repo.clone(), realtime.clone());
    let url = "https://github.com/org/repo/pull/123";
    let other = MacroUserIdStr::try_from_email("other@example.com").unwrap();
    assert!(matches!(
        service.set_pull_request(session.id, &other, url).await,
        Err(AgentSessionError::Forbidden)
    ));
    assert!(repo.list_by_session(session.id).await.unwrap().is_empty());
    service
        .set_pull_request(session.id, &session.owner_id, url)
        .await
        .unwrap();
    service
        .set_pull_request(session.id, &session.owner_id, url)
        .await
        .unwrap();
    let log = repo.list_by_session(session.id).await.unwrap();
    assert_eq!(log.len(), 1);
    assert!(
        matches!(&log[0].entry.content, Message::ToServer(ToServerMessage::PullRequestSet { url: stored }) if stored == url)
    );
    assert_eq!(realtime.published().len(), 1);
    service
        .set_pull_request(
            session.id,
            &session.owner_id,
            "https://github.com/org/repo/pull/124",
        )
        .await
        .unwrap();
    assert_eq!(repo.list_by_session(session.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn tool_access_requires_the_session_credential_owner_and_an_active_non_cursor_session() {
    use crate::domain::model::CreateAgentSessionParams;
    let repo = InMemoryAgentSessionRepo::new();
    let template = test_agent_session(AgentSessionId::new());
    let session = AgentSessionRepo::create(
        &repo,
        CreateAgentSessionParams {
            id: template.id,
            owner_id: template.owner_id,
            bot_id: template.bot_id,
            thread_id: None,
            originating_message_id: None,
            model: template.model,
            harness: template.harness,
            repo_url: template.repo_url,
            workspace: template.workspace,
            sandbox_size: template.sandbox_size,
            instructions: None,
            mcp_servers: template.mcp_servers,
            egress_token_hash: Some("verified-token-hash".into()),
        },
    )
    .await
    .unwrap();
    let service = SessionPullRequestService::new(repo.clone(), RecordingRealtime::new());
    assert_eq!(
        service
            .tool_session("verified-token-hash", &session.owner_id)
            .await
            .unwrap(),
        session.id
    );
    assert!(
        service
            .tool_session("unknown", &session.owner_id)
            .await
            .is_err()
    );
    assert!(
        service
            .tool_session(
                "verified-token-hash",
                &MacroUserIdStr::try_from_email("other@example.com").unwrap()
            )
            .await
            .is_err()
    );
    let mut changed = session.clone();
    changed.harness = "cursor".into();
    repo.insert_session(changed);
    assert!(
        service
            .tool_session("verified-token-hash", &session.owner_id)
            .await
            .is_err()
    );
    let mut changed = session.clone();
    changed.status = SessionStatus::Disconnected;
    repo.insert_session(changed);
    assert!(
        service
            .tool_session("verified-token-hash", &session.owner_id)
            .await
            .is_err()
    );
}
