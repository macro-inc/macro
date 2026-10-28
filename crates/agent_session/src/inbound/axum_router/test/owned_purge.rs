use super::*;
use crate::domain::error::Result as SessionResult;
use crate::domain::ports::{AcceptedControl, QueuedControl};
use shared_entity_registry::OwnedPurgeOutcome;

const INTERNAL_KEY: &str = "test-internal-key";
const SESSION: Uuid = Uuid::from_u128(0x5E55);

/// Answers every purge with `answer`, or with an error the shared mapping
/// would turn into 409 when it is `None`, and records what reached it.
struct OwnedSessions {
    answer: Option<OwnedPurgeOutcome>,
    calls: Mutex<Vec<(AgentSessionId, Owner)>>,
}

impl OwnedSessions {
    fn answering(answer: Option<OwnedPurgeOutcome>) -> Arc<Self> {
        Arc::new(Self {
            answer,
            calls: Mutex::default(),
        })
    }

    fn calls(&self) -> Vec<(AgentSessionId, Owner)> {
        self.calls.lock().unwrap().clone()
    }
}

impl AgentSessionNotificationRecipient for OwnedSessions {
    async fn purge_owned_session(
        &self,
        id: AgentSessionId,
        expected_owner: &Owner,
    ) -> SessionResult<OwnedPurgeOutcome> {
        self.calls
            .lock()
            .unwrap()
            .push((id, expected_owner.clone()));
        self.answer.ok_or(AgentSessionError::Disconnected(id))
    }
    async fn delete_user_sessions(&self, _: MacroUserIdStr<'static>) -> SessionResult<()> {
        unreachable!()
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
    async fn steer_queued_control(
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

async fn purge(recipient: &Arc<OwnedSessions>, uri: &str, headers: &[(&str, &str)]) -> StatusCode {
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_KEY.into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )
    .with_harness_authorizer(SelfHarnessAuthorizer);
    let router: Router = agent_session_control_router(AgentSessionControlState::new(
        Arc::clone(recipient),
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(auth)),
    ));
    let mut request = Request::builder().method("DELETE").uri(uri);
    for (key, value) in headers {
        request = request.header(*key, *value);
    }
    router
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}

async fn purge_internally(recipient: &Arc<OwnedSessions>, uri: &str) -> StatusCode {
    purge(
        recipient,
        uri,
        &[(macro_authorization::INTERNAL_API_KEY_HEADER, INTERNAL_KEY)],
    )
    .await
}

fn team_purge_uri() -> String {
    format!("/internal/{SESSION}?owner={TEAM_ID}")
}

#[tokio::test]
async fn each_purge_outcome_answers_its_own_status() {
    for (answer, status) in [
        (Some(OwnedPurgeOutcome::Purged), StatusCode::NO_CONTENT),
        (
            Some(OwnedPurgeOutcome::OwnedElsewhere),
            StatusCode::CONFLICT,
        ),
        (None, StatusCode::INTERNAL_SERVER_ERROR),
    ] {
        let recipient = OwnedSessions::answering(answer);

        assert_eq!(
            purge_internally(&recipient, &team_purge_uri()).await,
            status
        );
        assert_eq!(
            recipient.calls(),
            [(AgentSessionId::new_from_uuid(SESSION), Owner::Team(TEAM_ID))]
        );
    }
}

#[tokio::test]
async fn the_owner_query_reaches_the_recipient_as_a_principal() {
    let recipient = OwnedSessions::answering(Some(OwnedPurgeOutcome::Purged));
    let bot = Owner::Bot(BotId::TEST_A);
    let encoded_bot = bot.principal_id().replace('|', "%7C");

    let status = purge_internally(
        &recipient,
        &format!("/internal/{SESSION}?owner={encoded_bot}"),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        recipient.calls(),
        [(AgentSessionId::new_from_uuid(SESSION), bot)]
    );
}

#[tokio::test]
async fn only_the_internal_key_may_purge() {
    let recipient = OwnedSessions::answering(Some(OwnedPurgeOutcome::Purged));
    let bearer = format!("Bearer {OWNER}");
    for headers in [
        vec![],
        vec![("authorization", bearer.as_str())],
        vec![(BOT_TOKEN_HEADER, BOT_TOKEN), (BOT_SCOPE_HEADER, "user")],
        vec![(HARNESS_TOKEN_HEADER, HARNESS_TOKEN)],
        vec![(macro_authorization::INTERNAL_API_KEY_HEADER, "bad-key")],
    ] {
        let status = purge(&recipient, &team_purge_uri(), &headers).await;
        assert!(status.is_client_error(), "{headers:?} answered {status}");
    }
    assert!(recipient.calls().is_empty());
}

#[tokio::test]
async fn a_malformed_purge_is_refused_before_the_recipient() {
    let recipient = OwnedSessions::answering(Some(OwnedPurgeOutcome::Purged));
    for uri in [
        format!("/internal/not-a-session?owner={TEAM_ID}"),
        format!("/internal/{SESSION}"),
        format!("/internal/{SESSION}?owner=not-an-owner"),
    ] {
        assert_eq!(
            purge_internally(&recipient, &uri).await,
            StatusCode::BAD_REQUEST,
            "{uri}"
        );
    }
    assert!(recipient.calls().is_empty());
}
