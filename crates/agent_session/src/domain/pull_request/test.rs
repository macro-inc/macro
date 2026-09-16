use super::*;
use crate::domain::ports::AgentSessionLogRepo;
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};

#[test]
fn normalizes_pr_urls_and_rejects_non_pr_destinations() {
    assert_eq!(
        canonical_url("https://github.com/org/repo/pull/001/#discussion").unwrap(),
        "https://github.com/org/repo/pull/1"
    );
    assert_eq!(
        canonical_url("https://GITHUB.com:443/org/repo/pull/42?diff=split#discussion").unwrap(),
        "https://github.com/org/repo/pull/42"
    );
    for invalid in [
        "javascript:alert(1)",
        "http://github.com/org/repo/pull/1",
        "https://evil.com/org/repo/pull/1",
        "https://user@github.com/org/repo/pull/1",
        "https://github.com/org/repo/issues/1",
        "https://github.com/org/repo/pull/0",
        "https://github.com/org/repo/pull/1/files",
        "https://github.com:8443/org/repo/pull/1",
        "https://github.com.evil.com/org/repo/pull/1",
        "https://github.com/org/repo/pull/18446744073709551616",
        "https://github.com/org/repo/pull/1\n",
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
    assert!(repo.list_by_session(session.id).await.unwrap().is_empty());
    assert_eq!(
        repo.get(session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some(url)
    );
    assert_eq!(realtime.updated(), [session.id]);
    service
        .set_pull_request(
            session.id,
            &session.owner_id,
            "https://github.com/org/repo/pull/124",
        )
        .await
        .unwrap();
    assert!(repo.list_by_session(session.id).await.unwrap().is_empty());
    assert_eq!(
        repo.get(session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some("https://github.com/org/repo/pull/124")
    );
    assert_eq!(realtime.updated(), [session.id, session.id]);
}

#[tokio::test]
async fn gateway_failure_does_not_undo_the_persisted_link() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_agent_session(AgentSessionId::new());
    repo.insert_session(session.clone());
    let service = SessionPullRequestService::new(repo.clone(), RecordingRealtime::down());
    let url = "https://github.com/org/repo/pull/123";
    service
        .set_pull_request(session.id, &session.owner_id, url)
        .await
        .unwrap();
    assert_eq!(
        repo.get(session.id)
            .await
            .unwrap()
            .pull_request_url
            .as_deref(),
        Some(url)
    );
}
