//! What the dial route decides, end to end over a real socket: who may take
//! over a bot's connection, and what a refusal looks like to the runtime.
//!
//! A refusal has to be an HTTP status rather than a closed socket, so every
//! rejection case asserts the status the upgrade failed with and that nothing
//! reached the registry.

use super::*;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::ports::BotFacts;
use bot_id::BotId;
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotAuthorizer,
    BotScope, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
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

/// Authorizes exactly one token, as [`BotId::TEST_A`].
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
            token_id: macro_uuid::generate_uuid_v7(),
            bot_scope,
            team_id: None,
            acting_user: None,
        })
    }
}

/// Answers every lookup the same way.
enum FactsDirectory {
    Known(BotFacts),
    Unreadable,
}

impl BotDirectory for FactsDirectory {
    async fn bot_facts(
        &self,
        _bot: BotId,
    ) -> agent_session::domain::error::Result<Option<BotFacts>> {
        match self {
            Self::Known(facts) => Ok(Some(facts.clone())),
            Self::Unreadable => Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "the bots table is unreachable"
            ))),
        }
    }
}

/// A bot whose runtime its operator hosts: the only kind that may dial.
fn external_facts() -> BotFacts {
    BotFacts {
        has_agent: true,
        is_managed: false,
        owner_user_id: Some(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
    }
}

/// Serve the gateway on a loopback port, returning the registry it feeds and
/// the `ws://` base to dial.
async fn serve(directory: FactsDirectory) -> (Arc<RuntimeRegistry<GatewaySender>>, String) {
    let runtimes = RuntimeRegistry::new();
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
            Arc::clone(&runtimes),
            Arc::new(directory),
            MacroAuthorizationState::new(Arc::new(authorization)),
        )),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    (runtimes, format!("ws://{address}"))
}

fn dial_request(base: &str, token: Option<&str>) -> tungstenite::handshake::client::Request {
    use tungstenite::client::IntoClientRequest as _;
    let mut request = format!("{base}/runtime/ws").into_client_request().unwrap();
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
async fn a_valid_dial_becomes_the_bots_connection() {
    let (runtimes, base) = serve(FactsDirectory::Known(external_facts())).await;

    let (_socket, _) = tokio_tungstenite::connect_async(dial_request(&base, Some(BOT_TOKEN)))
        .await
        .expect("the dial is valid");

    // The registry is populated after the upgrade completes, so the assertion
    // is a wait rather than a read.
    while !runtimes.is_connected(BotId::TEST_A) {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn a_bad_token_is_unauthorized() {
    let (runtimes, base) = serve(FactsDirectory::Known(external_facts())).await;

    let status = rejected(dial_request(&base, Some("mbot_wrong"))).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!runtimes.is_connected(BotId::TEST_A));
}

#[tokio::test]
async fn a_missing_token_is_rejected() {
    let (runtimes, base) = serve(FactsDirectory::Known(external_facts())).await;

    let status = rejected(dial_request(&base, None)).await;

    // No credentials at all: the extractor rejects before anything runs.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!runtimes.is_connected(BotId::TEST_A));
}

#[tokio::test]
async fn a_managed_bot_may_not_dial() {
    let mut facts = external_facts();
    facts.is_managed = true;
    let (runtimes, base) = serve(FactsDirectory::Known(facts)).await;

    let status = rejected(dial_request(&base, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(!runtimes.is_connected(BotId::TEST_A));
}

#[tokio::test]
async fn revoked_agenthood_may_not_dial() {
    let mut facts = external_facts();
    facts.has_agent = false;
    let (runtimes, base) = serve(FactsDirectory::Known(facts)).await;

    let status = rejected(dial_request(&base, Some(BOT_TOKEN))).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(!runtimes.is_connected(BotId::TEST_A));
}

#[tokio::test]
async fn an_unreadable_bot_lookup_fails_the_dial() {
    let (runtimes, base) = serve(FactsDirectory::Unreadable).await;

    let status = rejected(dial_request(&base, Some(BOT_TOKEN))).await;

    // A lookup that failed is not a lookup that said no: the runtime is told
    // to come back rather than that it is unwelcome.
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(!runtimes.is_connected(BotId::TEST_A));
}
