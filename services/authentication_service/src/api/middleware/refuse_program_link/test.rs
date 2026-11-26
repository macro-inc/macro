use super::*;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::post,
};
use macro_auth::{
    macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token},
    middleware::decode_jwt::JwtValidationArgs,
};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, PgUserApiKeyAuthorizationRepo,
    PgUserApiKeyAuthorizer,
};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const PRIVATE: &str = include_str!(
    "../../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

/// The two link-start routes behind the guard, answering 200 when reached.
fn router() -> Router {
    let db = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(200))
        .connect_lazy("postgres://nobody@127.0.0.1:1/none")
        .unwrap();
    let authorization = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::testing_macro_token("fixture", PUBLIC)),
        InternalAuthConfig {
            api_key: "test-internal-key".to_owned(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db)),
    )));
    Router::new()
        .route("/link/gmail", post(|| async { StatusCode::OK }))
        .route("/link/github", post(|| async { StatusCode::OK }))
        .layer(axum::middleware::from_fn_with_state(authorization, handler))
}

fn token(agent: Option<Uuid>, routine: Option<Uuid>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        fusionauth_id: "fixture".into(),
        macro_user_id: "macro|owner@example.com".into(),
        organization_id: None,
        issuer: "fixture".into(),
        private_key: PRIVATE.into(),
        expiry_seconds: 60,
        agent_id: agent,
        agent_via: None,
        agent_correlation_id: None,
        agent_session_id: None,
        routine_id: routine,
        agent_scope: None,
    })
    .unwrap()
}

async fn start(uri: &str, bearer: &str, code_execution: bool) -> (StatusCode, String) {
    let mut request = Request::post(uri).header("authorization", format!("Bearer {bearer}"));
    if code_execution {
        request = request.header(macro_authorization::CODE_EXECUTION_HEADER, "1");
    }
    let response = router()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8_lossy(&body).into_owned())
}

/// The consent URL a link start returns works in any browser, so a program
/// could hand it to someone else, whose Google or GitHub identity would then
/// sign in to this account: only a person starts a link.
#[tokio::test]
async fn a_program_cannot_start_a_sign_in_link() {
    let agent = token(Some(Uuid::from_u128(1)), None);
    let routine = token(None, Some(Uuid::from_u128(2)));
    let person = token(None, None);
    for uri in ["/link/gmail", "/link/github"] {
        for (program, bearer, code_execution) in [
            ("an agent run", agent.as_str(), false),
            ("an owner-identity routine run", routine.as_str(), false),
            ("the code-mode runtime", person.as_str(), true),
        ] {
            let (status, body) = start(uri, bearer, code_execution).await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{program} {uri}");
            assert!(body.contains("in Settings"), "{program} {uri}: {body}");
        }
    }
}

#[tokio::test]
async fn a_person_starts_a_link() {
    let person = token(None, None);
    for uri in ["/link/gmail", "/link/github"] {
        assert_eq!(start(uri, &person, false).await.0, StatusCode::OK, "{uri}");
    }
}

/// A credential that does not verify is rejected by the guard itself, so a
/// check that fails can never let a program's link start through.
#[tokio::test]
async fn a_credential_that_does_not_verify_is_rejected() {
    let (status, _) = start("/link/gmail", "not-a-token", false).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
