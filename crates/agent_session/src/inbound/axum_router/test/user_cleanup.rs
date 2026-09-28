use super::*;
use crate::domain::error::Result as SessionResult;
use crate::domain::ports::{AcceptedControl, QueuedControl};

#[derive(Default)]
struct Recipient(Mutex<Vec<MacroUserIdStr<'static>>>);

impl AgentSessionNotificationRecipient for Recipient {
    async fn delete_user_sessions(&self, owner: MacroUserIdStr<'static>) -> SessionResult<()> {
        self.0.lock().unwrap().push(owner);
        Ok(())
    }
    async fn session_deleted(&self, _: AgentSessionId) -> SessionResult<()> {
        unreachable!()
    }
    async fn control_event(
        &self,
        _: AgentSessionId,
        _: ControlEvent,
    ) -> SessionResult<AcceptedControl> {
        unreachable!()
    }
    async fn queued_controls(&self, _: AgentSessionId) -> SessionResult<Vec<QueuedControl>> {
        unreachable!()
    }
    async fn edit_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: String,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        unreachable!()
    }
    async fn remove_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        unreachable!()
    }
    async fn set_sandbox_size(&self, _: AgentSessionId, _: SandboxSize) -> SessionResult<()> {
        unreachable!()
    }
    async fn session_harness(
        &self,
        _: AgentSessionId,
    ) -> SessionResult<Option<harness_id::HarnessId>> {
        unreachable!()
    }
}

#[tokio::test]
async fn cleanup_requires_internal_credentials_not_user_bot_or_harness_authority() {
    let recipient = Arc::new(Recipient::default());
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )
    .with_harness_authorizer(SelfHarnessAuthorizer);
    let router: Router = agent_session_control_router(AgentSessionControlState::new(
        recipient.clone(),
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(auth)),
    ));
    let bearer = format!("Bearer {OWNER}");
    for headers in [
        vec![],
        vec![("authorization", bearer.as_str())],
        vec![(BOT_TOKEN_HEADER, BOT_TOKEN), (BOT_SCOPE_HEADER, "user")],
        vec![(HARNESS_TOKEN_HEADER, HARNESS_TOKEN)],
        vec![(macro_authorization::INTERNAL_API_KEY_HEADER, "bad-key")],
    ] {
        let mut request = Request::builder()
            .method("DELETE")
            .uri("/user/macro%7Cowner%40example.com");
        for (key, value) in headers {
            request = request.header(key, value);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(response.status().is_client_error());
        assert!(recipient.0.lock().unwrap().is_empty());
    }
    let response = router
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/user/macro%7Cowner%40example.com")
                .header(
                    macro_authorization::INTERNAL_API_KEY_HEADER,
                    "test-internal-key",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(recipient.0.lock().unwrap()[0].as_ref(), OWNER);
}
