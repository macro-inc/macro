use super::*;
use agent_runtime_protocol::domain::ports::Transport as _;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotAuthorizer,
    BotScope, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::sync::Mutex;
use tokio_tungstenite::tungstenite;

const BOT_TOKEN: &str = "mbot_self_test";

#[derive(Clone, Default)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        Ok(ValidatedIdentity {
            user_id: jwt.to_string(),
            fusion_user_id: "fusion-user".to_string(),
            organization_id: None,
            permissions: None,
        })
    }
}

#[derive(Clone)]
struct SelfBotAuthorizer;

impl BotAuthorizer for SelfBotAuthorizer {
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        _acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if bot_token != BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(BotAuthentication {
            bot_id: BotId::TEST_A,
            token_id: Uuid::new_v4(),
            bot_scope,
            team_id: None,
            acting_user: None,
        })
    }
}

/// Knows one session, [`AgentSessionId::TEST_A`], owned by the given bot.
struct OneSession {
    bot: BotId,
}

impl SessionBotLookup for OneSession {
    async fn session_bot(&self, session: AgentSessionId) -> Option<BotId> {
        (session == AgentSessionId::TEST_A).then_some(self.bot)
    }
}

struct FactsDirectory {
    facts: agent_session::domain::ports::BotFacts,
}

impl BotDirectory for FactsDirectory {
    async fn bot_facts(
        &self,
        _bot: BotId,
    ) -> agent_session::domain::error::Result<Option<agent_session::domain::ports::BotFacts>> {
        Ok(Some(self.facts.clone()))
    }
}

fn external_facts() -> agent_session::domain::ports::BotFacts {
    agent_session::domain::ports::BotFacts {
        has_agent: true,
        is_managed: false,
        owner_user_id: Some(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
    }
}

/// Records attaches and keeps the transports so a test can drive them.
#[derive(Default)]
struct RecordingAttacher {
    attached: Mutex<Vec<(AgentSessionId, GatewayTransport)>>,
}

impl RuntimeAttacher for Arc<RecordingAttacher> {
    async fn attach_external_runtime(
        &self,
        session: AgentSessionId,
        runtime: GatewayTransport,
    ) -> Result<(), HarnessError> {
        self.attached.lock().unwrap().push((session, runtime));
        Ok(())
    }
}

async fn serve(
    attacher: Arc<RecordingAttacher>,
    session_bot: BotId,
    facts: agent_session::domain::ports::BotFacts,
) -> String {
    let authorization = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
    );
    let app: Router = Router::new().nest(
        "/runtime",
        runtime_gateway_router(RuntimeGatewayState::new(
            Arc::new(attacher),
            Arc::new(OneSession { bot: session_bot }),
            Arc::new(FactsDirectory { facts }),
            MacroAuthorizationState::new(Arc::new(authorization)),
        )),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    format!("ws://{address}")
}

fn dial_request(
    base: &str,
    session: AgentSessionId,
    token: Option<&str>,
) -> tungstenite::handshake::client::Request {
    use tungstenite::client::IntoClientRequest as _;
    let mut request = format!("{base}/runtime/{session}/ws")
        .into_client_request()
        .unwrap();
    if let Some(token) = token {
        let headers = request.headers_mut();
        headers.insert(BOT_TOKEN_HEADER, token.parse().unwrap());
        headers.insert(BOT_SCOPE_HEADER, "user".parse().unwrap());
    }
    request
}

/// Dial expecting rejection; return the HTTP status the upgrade failed with.
async fn rejected(request: tungstenite::handshake::client::Request) -> StatusCode {
    match tokio_tungstenite::connect_async(request).await {
        Err(tungstenite::Error::Http(response)) => response.status(),
        other => panic!("expected an upgrade rejection, got {other:?}"),
    }
}

#[tokio::test]
async fn a_valid_dial_attaches_and_relays_frames() {
    let attacher = Arc::new(RecordingAttacher::default());
    let base = serve(attacher.clone(), BotId::TEST_A, external_facts()).await;

    let (mut socket, _) = tokio_tungstenite::connect_async(dial_request(
        &base,
        AgentSessionId::TEST_A,
        Some(BOT_TOKEN),
    ))
    .await
    .expect("the dial is valid");

    // The attach is recorded for the right session...
    let transport = loop {
        if let Some((session, transport)) = attacher.attached.lock().unwrap().first().cloned() {
            assert_eq!(session, AgentSessionId::TEST_A);
            break transport;
        }
        tokio::task::yield_now().await;
    };

    // ...and what the worker says arrives through it.
    use futures::SinkExt as _;
    let ready = serde_json::to_string(&ToServerMessage::Event {
        event: SystemEvent::AcpReady,
    })
    .unwrap();
    socket
        .send(tungstenite::Message::text(ready))
        .await
        .unwrap();
    let received = transport.recv().await.expect("the transport is live");
    assert!(matches!(
        received,
        Some(ToServerMessage::Event {
            event: SystemEvent::AcpReady
        })
    ));
}

#[tokio::test]
async fn a_bad_token_is_unauthorized() {
    let attacher = Arc::new(RecordingAttacher::default());
    let base = serve(attacher.clone(), BotId::TEST_A, external_facts()).await;

    let status = rejected(dial_request(
        &base,
        AgentSessionId::TEST_A,
        Some("mbot_wrong"),
    ))
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(attacher.attached.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_session_is_not_found() {
    let attacher = Arc::new(RecordingAttacher::default());
    let base = serve(attacher.clone(), BotId::TEST_A, external_facts()).await;

    let status = rejected(dial_request(&base, AgentSessionId::TEST_B, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(attacher.attached.lock().unwrap().is_empty());
}

#[tokio::test]
async fn another_bots_session_is_forbidden() {
    let attacher = Arc::new(RecordingAttacher::default());
    let base = serve(attacher.clone(), BotId::TEST_B, external_facts()).await;

    let status = rejected(dial_request(&base, AgentSessionId::TEST_A, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(attacher.attached.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_managed_bots_session_is_not_dialable() {
    let attacher = Arc::new(RecordingAttacher::default());
    let mut facts = external_facts();
    facts.is_managed = true;
    let base = serve(attacher.clone(), BotId::TEST_A, facts).await;

    let status = rejected(dial_request(&base, AgentSessionId::TEST_A, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(attacher.attached.lock().unwrap().is_empty());
}

#[tokio::test]
async fn revoked_agenthood_is_not_dialable() {
    let attacher = Arc::new(RecordingAttacher::default());
    let mut facts = external_facts();
    facts.has_agent = false;
    let base = serve(attacher.clone(), BotId::TEST_A, facts).await;

    let status = rejected(dial_request(&base, AgentSessionId::TEST_A, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(attacher.attached.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_missing_token_is_rejected() {
    let attacher = Arc::new(RecordingAttacher::default());
    let base = serve(attacher.clone(), BotId::TEST_A, external_facts()).await;

    let status = rejected(dial_request(&base, AgentSessionId::TEST_A, None)).await;

    // No credentials at all: the extractor rejects before anything runs.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(attacher.attached.lock().unwrap().is_empty());
}
