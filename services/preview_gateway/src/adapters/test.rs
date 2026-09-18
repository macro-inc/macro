use super::*;
use agent_session::{
    domain::model::SessionStatus,
    testing::{InMemoryAgentSessionRepo, test_agent_session},
};

#[tokio::test]
async fn direct_mcp_credentials_follow_revocation_while_established_previews_survive_detach() {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let mut session = test_agent_session(id);
    repo.insert_session(session.clone());
    let token = SessionToken::new("test-session-token");
    repo.set_egress_token_hash(id, &token.hash()).await.unwrap();
    // This test only exercises session authentication, so no access DB connection is opened.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .unwrap();
    let authority = MacroAuthority {
        sessions: repo.clone(),
        access: Arc::new(
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool),
            ),
        ),
    };
    assert!(authority.agent(token.as_str()).await.is_ok());
    session.status = SessionStatus::Disconnected;
    repo.insert_session(session);
    assert!(matches!(
        authority.agent(token.as_str()).await,
        Err(PreviewError::Denied)
    ));
    assert!(authority.active(&id.to_string()).await.is_ok());
    assert!(matches!(
        authority.agent("unknown").await,
        Err(PreviewError::Denied)
    ));
}
