//! What the dial route decides, end to end over a real socket: who may take
//! over a harness's connection, how often, and what a refusal looks like to
//! the runtime.
//!
//! A refusal has to be an HTTP status rather than a closed socket, so every
//! rejection case asserts the status the upgrade failed with and that nothing
//! reached the registry.

use super::*;
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
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: jwt.to_string(),
                fusion_user_id: "fusion-user".to_string(),
                organization_id: None,
                permissions: None,
            },
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
                origin: macro_authorization::CredentialOrigin::Harness,
                agent_id: None,
                agent_via: None,
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
    serve_with(DialBudget::default()).await
}

async fn serve_with(dials: DialBudget) -> (Arc<RuntimeRegistry<GatewaySender>>, String) {
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
        runtime_gateway_router(
            RuntimeGatewayState::new(
                Arc::clone(&runtimes),
                MacroAuthorizationState::new(Arc::new(authorization)),
            )
            .with_dial_budget(dials),
        ),
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

/// Dial expecting rejection; return the response the upgrade failed with.
async fn rejection(
    request: tungstenite::handshake::client::Request,
) -> tungstenite::http::Response<Option<Vec<u8>>> {
    match tokio_tungstenite::connect_async(request).await {
        Err(tungstenite::Error::Http(response)) => *response,
        other => panic!("expected an upgrade rejection, got {other:?}"),
    }
}

/// Dial expecting rejection; return the HTTP status the upgrade failed with.
async fn rejected(request: tungstenite::handshake::client::Request) -> StatusCode {
    rejection(request).await.status()
}

fn one_dial_per_minute() -> DialBudget {
    DialBudget::new(NonZeroU32::MIN, Duration::from_secs(60))
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

#[tokio::test]
async fn a_harness_past_its_dial_budget_is_refused_with_retry_after() {
    let (_runtimes, base) = serve_with(one_dial_per_minute()).await;

    let (_socket, _) = tokio_tungstenite::connect_async(dial_request(&base, Some(HARNESS_TOKEN)))
        .await
        .expect("the first dial is within budget");
    let response = rejection(dial_request(&base, Some(HARNESS_TOKEN))).await;

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let retry_after: u64 = response
        .headers()
        .get(RETRY_AFTER)
        .expect("a refusal says when to come back")
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(
        (1..=60).contains(&retry_after),
        "retry after {retry_after}s"
    );
}

#[tokio::test]
async fn an_unauthenticated_dial_spends_no_budget() {
    let (_runtimes, base) = serve_with(one_dial_per_minute()).await;

    assert_eq!(
        rejected(dial_request(&base, Some("mhns_wrong"))).await,
        StatusCode::UNAUTHORIZED
    );
    tokio_tungstenite::connect_async(dial_request(&base, Some(HARNESS_TOKEN)))
        .await
        .expect("the harness's own dial is still within budget");
}

#[test]
fn the_budget_admits_a_burst_then_one_dial_per_interval() {
    let budget = DialBudget::new(NonZeroU32::new(6).unwrap(), Duration::from_secs(60));
    let start = Instant::now();

    for _ in 0..6 {
        assert_eq!(
            budget.admit(HarnessId::TEST_A, start),
            DialAdmission::Admitted
        );
    }
    assert_eq!(
        budget.admit(HarnessId::TEST_A, start),
        DialAdmission::Refused {
            retry_after: Duration::from_secs(10)
        }
    );
    // A refusal costs nothing: the wait is the same a second later, less a second.
    assert_eq!(
        budget.admit(HarnessId::TEST_A, start + Duration::from_secs(1)),
        DialAdmission::Refused {
            retry_after: Duration::from_secs(9)
        }
    );
    assert_eq!(
        budget.admit(HarnessId::TEST_A, start + Duration::from_secs(10)),
        DialAdmission::Admitted
    );
    assert!(matches!(
        budget.admit(HarnessId::TEST_A, start + Duration::from_secs(10)),
        DialAdmission::Refused { .. }
    ));
    // Each harness has its own budget.
    assert_eq!(
        budget.admit(HarnessId::TEST_B, start),
        DialAdmission::Admitted
    );
    // A minute of quiet refills the whole burst.
    let later = start + Duration::from_secs(80);
    for _ in 0..6 {
        assert_eq!(
            budget.admit(HarnessId::TEST_A, later),
            DialAdmission::Admitted
        );
    }
}

#[test]
fn the_budget_forgets_harnesses_back_at_full_budget() {
    let mut budget = one_dial_per_minute();
    budget.max_tracked = 1;
    let start = Instant::now();

    assert_eq!(
        budget.admit(HarnessId::TEST_A, start),
        DialAdmission::Admitted
    );
    // A is still spent, so B is admitted untracked rather than evicting it.
    assert_eq!(
        budget.admit(HarnessId::TEST_B, start),
        DialAdmission::Admitted
    );
    assert_eq!(
        budget.admit(HarnessId::TEST_B, start),
        DialAdmission::Admitted
    );
    assert!(matches!(
        budget.admit(HarnessId::TEST_A, start),
        DialAdmission::Refused { .. }
    ));

    // Once A refills, B takes its slot and is limited from then on.
    let later = start + Duration::from_secs(60);
    assert_eq!(
        budget.admit(HarnessId::TEST_B, later),
        DialAdmission::Admitted
    );
    assert!(matches!(
        budget.admit(HarnessId::TEST_B, later),
        DialAdmission::Refused { .. }
    ));
    assert_eq!(budget.full_again.lock().unwrap().len(), 1);
}

#[test]
fn retry_after_rounds_up_to_whole_seconds() {
    assert_eq!(whole_seconds_after(Duration::ZERO), 1);
    assert_eq!(whole_seconds_after(Duration::from_millis(1)), 1);
    assert_eq!(whole_seconds_after(Duration::from_secs(10)), 10);
    assert_eq!(whole_seconds_after(Duration::from_millis(10_001)), 11);
}
