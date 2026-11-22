//! A real signed Macro API token passes through propagation into the real domain gate.
//! Only account access, storage and the upstream app are fixture ports.
use super::*;
use agent_correlation::domain::{Correlation, CorrelationError, CorrelationRepository};
use agent_correlation::inbound::{CorrelationState, propagate};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{Request, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::get,
};
use macro_auth::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceExt;

const PRIVATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
));
const PUBLIC: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
));
const APPS: &str = "/agent-sessions/00000000-0000-0000-0000-0000000000ca/code-executions/00000000-0000-0000-0000-000000000066/connected-apps";
const CALL: &str = "/agent-sessions/00000000-0000-0000-0000-0000000000ca/code-executions/00000000-0000-0000-0000-000000000066/connected-apps/app/fixture/calls";

struct Correlations;
#[async_trait]
impl CorrelationRepository for Correlations {
    async fn create(
        &self,
        _: Uuid,
        _: Uuid,
        _: Option<SessionScope>,
    ) -> Result<Uuid, CorrelationError> {
        unreachable!()
    }
    async fn find(&self, id: Uuid) -> Result<Option<Correlation>, CorrelationError> {
        Ok(match id.as_u128() {
            301 => Some(Correlation {
                session_id: Uuid::from_u128(201),
                agent_id: Uuid::from_u128(601),
                scope: None,
                revoked: false,
            }),
            302 | 303 | 999 => Some(Correlation {
                session_id: Uuid::from_u128(202),
                agent_id: Uuid::from_u128(601),
                scope: None,
                revoked: false,
            }),
            _ => None,
        })
    }
    async fn revoke(&self, _: Uuid) -> Result<(), CorrelationError> {
        unreachable!()
    }
}
fn token(
    correlation: Option<u128>,
    scope: Option<&str>,
    routine: Option<Uuid>,
    via: Option<&str>,
) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture-owner".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: Some(Uuid::from_u128(601)),
        agent_via: via.map(str::to_owned),
        agent_correlation_id: correlation.map(Uuid::from_u128),
        agent_session_id: correlation.map(|id| Uuid::from_u128(if id == 301 { 201 } else { 202 })),
        routine_id: routine,
        agent_scope: scope.map(str::to_owned),
    })
    .unwrap()
}
async fn list_apps(
    State(fixture): State<Arc<Fixture>>,
    Path((session, execution)): Path<(Uuid, Uuid)>,
) -> Response {
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        fixture.owner.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );
    match fixture
        .service
        .apps(&access, &fixture.owner, ExecutionId::from_uuid(execution))
        .await
    {
        Ok(apps) => Json(apps).into_response(),
        Err(CodeModeError::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
async fn call_app(
    State(fixture): State<Arc<Fixture>>,
    Path((session, execution)): Path<(Uuid, Uuid)>,
) -> Response {
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
        fixture.owner.clone(),
        &session.to_string(),
        EntityType::AgentSession,
    );
    match fixture
        .service
        .call(
            &access,
            &fixture.owner,
            ExecutionId::from_uuid(execution),
            ConnectedAppRef {
                kind: ConnectedAppKind::App,
                key: "fixture".into(),
            },
            CallConnectedTool {
                tool: "read_owned_data".into(),
                arguments: serde_json::Map::new(),
            },
        )
        .await
    {
        Ok(answer) => Json(answer).into_response(),
        Err(CodeModeError::Forbidden) => StatusCode::FORBIDDEN.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
fn app(fixture: Arc<Fixture>) -> Router {
    Router::new().route("/agent-sessions/{session}/code-executions/{execution}/connected-apps", get(list_apps))
        .route("/agent-sessions/{session}/code-executions/{execution}/connected-apps/app/fixture/calls", axum::routing::post(call_app))
        .with_state(fixture)
        .layer(middleware::from_fn_with_state(CorrelationState { jwt:JwtValidationArgs::testing_macro_token("fixture", PUBLIC), repository:Arc::new(Correlations), specs: None }.serving(&["agent-harness"]), propagate))
}

#[tokio::test]
async fn signed_other_session_sibling_and_scoped_credentials_never_reach_the_app() {
    let fixture = Arc::new(Fixture::new(true));
    let router = app(fixture.clone());
    let mut failures = Vec::new();
    for (label, bearer) in [
        ("other live session", token(Some(301), None, None, None)),
        ("sibling execution", token(Some(303), None, None, None)),
        (
            "routine borrowing a live execution",
            token(Some(301), None, Some(Uuid::from_u128(501)), None),
        ),
        (
            "public MCP borrowing a live execution",
            token(Some(999), None, None, Some("Fixture client")),
        ),
        ("uncorrelated", token(None, None, None, None)),
        ("NoSend mention", token(None, Some("no_send"), None, None)),
        (
            "unknown signed scope",
            token(Some(302), Some("future_scope"), None, None),
        ),
    ] {
        for (method, path) in [("GET", APPS), ("POST", CALL)] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("authorization", format!("Bearer {bearer}"))
                        .body(axum::body::Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            if response.status() != StatusCode::FORBIDDEN {
                failures.push(format!("{label}: {method} -> {}", response.status()));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn signed_own_session_routine_and_public_mcp_calls_still_work() {
    let fixture = Arc::new(Fixture::new(true));
    let router = app(fixture.clone());
    for bearer in [
        token(Some(302), None, None, None),
        token(Some(302), None, Some(Uuid::from_u128(501)), None),
        token(Some(302), None, None, Some("Fixture client")),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(CALL)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn a_historical_record_without_an_issued_binding_is_refused() {
    let fixture = Arc::new(Fixture::new(false));
    let response = app(fixture.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(CALL)
                .header(
                    "authorization",
                    format!("Bearer {}", token(Some(302), None, None, None)),
                )
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_unknown_scope_on_a_secondary_verified_token_still_refuses_apps() {
    let fixture = Arc::new(Fixture::new(true));
    let primary = token(Some(302), None, None, None);
    let secondary = token(None, Some("future_scope"), None, None);
    let response = app(fixture.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(APPS)
                .header("authorization", format!("Bearer {primary}"))
                .header(
                    "cookie",
                    format!(
                        "{}={secondary}",
                        macro_auth::credential::access_token_cookie_name()
                    ),
                )
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(fixture.apps.effects.load(Ordering::SeqCst), 0);
}
