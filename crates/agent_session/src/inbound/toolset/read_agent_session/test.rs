use super::*;
use crate::testing::InMemoryAgentSessionRepo;
use entity_access::domain::ports::NoOpEntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn failed_access_check_never_reads_session_metadata_or_history() {
    let repo = InMemoryAgentSessionRepo::new();
    let context = ServiceContext(ReadAgentSessionContext {
        service: Arc::new(SessionReader::new(repo.clone())),
        sharing: Arc::new(crate::domain::sharing::SessionSharingService::new(
            repo.clone(),
        )),
        access: Arc::new(NoOpEntityAccessService),
    });
    let result = ReadAgentSession {
        session_id: uuid::Uuid::nil(),
        turn: None,
    }
    .call(
        context,
        RequestContext::new(MacroUserIdStr::try_from_email("viewer@example.com").expect("viewer")),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(repo.session_reads(), 0);
    assert_eq!(repo.log_reads(), 0);
}

#[test]
fn rejects_ai_supplied_identity() {
    assert!(
        serde_json::from_value::<ReadAgentSession>(serde_json::json!({
            "sessionId": uuid::Uuid::nil(), "userId": "macro|someone@example.com"
        }))
        .is_err()
    );
}
