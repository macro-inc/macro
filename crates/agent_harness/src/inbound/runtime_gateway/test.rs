//! What the dial route decides, end to end over a real socket: who may take
//! over a harness's connection, and what a refusal looks like to the runtime.
//!
//! A refusal has to be an HTTP status rather than a closed socket, so every
//! rejection case asserts the status the upgrade failed with and that nothing
//! reached the registry.

use super::*;
use axum::http::StatusCode;
use harness_id::HarnessId;
use macro_authorization::{
    HARNESS_TOKEN_HEADER, HarnessAuthentication, HarnessAuthorizationOwner, HarnessAuthorizer,
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroUserAuthentication, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tokio_tungstenite::tungstenite;

const HARNESS_TOKEN: &str = "mhns_self_test";

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

/// Authorizes exactly one token, as [`HarnessId::TEST_A`].
#[derive(Clone)]
struct SelfHarnessAuthorizer;

impl HarnessAuthorizer for SelfHarnessAuthorizer {
    async fn authorize_harness(
        &self,
        harness_token: &str,
        _acting_user_claim: Option<String>,
    ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
        if harness_token != HARNESS_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        let macro_user_id =
            MacroUserIdStr::try_from_email("owner@example.com").expect("a valid email");
        let user_id = macro_user_id.as_ref().to_owned();
        Ok(HarnessAuthentication {
            harness_id: HarnessId::TEST_A,
            token_id: macro_uuid::generate_uuid_v7(),
            owner: HarnessAuthorizationOwner::User {
                user_id: user_id.clone(),
            },
            acting_user: MacroUserAuthentication {
                macro_user_id,
                user_context: model_user::UserContext {
                    user_id,
                    fusion_user_id: "fusion-owner".to_owned(),
                    permissions: None,
                    organization_id: None,
                },
            },
        })
    }
}

/// Serve the gateway on a loopback port, returning the registry it feeds and
/// the `ws://` base to dial.
async fn serve() -> (Arc<RuntimeRegistry<GatewaySender>>, String) {
    let runtimes = RuntimeRegistry::new();
    let authorization = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )
    .with_harness_authorizer(SelfHarnessAuthorizer);
    let app: Router = Router::new().nest(
        "/runtime",
        runtime_gateway_router(RuntimeGatewayState::new(
            Arc::clone(&runtimes),
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
        headers.insert(HARNESS_TOKEN_HEADER, token.parse().unwrap());
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
async fn a_valid_dial_becomes_the_harness_connection() {
    let (runtimes, base) = serve().await;

    let (_socket, _) = tokio_tungstenite::connect_async(dial_request(&base, Some(HARNESS_TOKEN)))
        .await
        .expect("the dial is valid");

    // The registry is populated after the upgrade completes, so the assertion
    // is a wait rather than a read.
    while !runtimes.is_connected(HarnessId::TEST_A) {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn a_bad_token_is_unauthorized() {
    let (runtimes, base) = serve().await;

    let status = rejected(dial_request(&base, Some("mhns_wrong"))).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!runtimes.is_connected(HarnessId::TEST_A));
}

#[tokio::test]
async fn a_missing_token_is_rejected() {
    let (runtimes, base) = serve().await;

    let status = rejected(dial_request(&base, None)).await;

    // No credentials at all: the extractor rejects before anything runs.
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!runtimes.is_connected(HarnessId::TEST_A));
}
