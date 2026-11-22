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

/// A sign-in route behind the guard, answering 200 when it is reached.
fn router() -> Router {
    // Unreachable: a user API key lookup fails fast.
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
        .route("/login/passwordless", post(|| async { StatusCode::OK }))
        .layer(axum::middleware::from_fn_with_state(authorization, handler))
}

fn token(agent: Option<Uuid>, routine: Option<Uuid>) -> String {
    encode_macro_api_token(EncodeMacroApiTokenArgs {
        channel_mention_channel_id: None,
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
        channel_mention_id: None,
        agent_scope: None,
    })
    .unwrap()
}

async fn sign_in(bearer: Option<&str>, code_execution: bool) -> (StatusCode, String) {
    sign_in_with(bearer, code_execution, &[], "/login/passwordless").await
}

async fn sign_in_with(
    bearer: Option<&str>,
    code_execution: bool,
    headers: &[(&str, &str)],
    uri: &str,
) -> (StatusCode, String) {
    let mut request = Request::post(uri);
    if let Some(bearer) = bearer {
        request = request.header("authorization", format!("Bearer {bearer}"));
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
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

/// A program that starts or finishes an email sign-in, then reads the code
/// from the user's inbox, holds the user's session: refuse it whether its
/// credential says so or the code-mode runtime does.
#[tokio::test]
async fn a_program_cannot_use_the_email_sign_in() {
    let agent = token(Some(Uuid::from_u128(1)), None);
    let routine = token(None, Some(Uuid::from_u128(2)));
    for (program, bearer, code_execution) in [
        ("an agent run", Some(agent.as_str()), false),
        (
            "an owner-identity routine run",
            Some(routine.as_str()),
            false,
        ),
        ("the code-mode runtime without a credential", None, true),
    ] {
        let (status, body) = sign_in(bearer, code_execution).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{program}");
        assert!(body.contains("sign in themselves"), "{program}: {body}");
    }
}

/// People sign in with no credential, a valid one, or a stale one; none of
/// those may be turned away.
#[tokio::test]
async fn a_person_signs_in_with_or_without_a_credential() {
    let person = token(None, None);
    for (who, bearer) in [
        ("signed out", None),
        ("already signed in", Some(person.as_str())),
        ("holding an invalid credential", Some("not-a-token")),
    ] {
        assert_eq!(sign_in(bearer, false).await.0, StatusCode::OK, "{who}");
    }
}

/// A stale session cookie, a bad token in the query, or a user API key whose
/// lookup fails all count as no credential.
#[tokio::test]
async fn a_credential_that_does_not_verify_never_blocks_a_sign_in() {
    for (who, headers, uri) in [
        (
            "a stale session cookie",
            vec![("cookie", "macro-access-token=stale")],
            "/login/passwordless",
        ),
        (
            "a bad token in the query",
            vec![],
            "/login/passwordless?macro-api-token=stale",
        ),
        (
            "a user API key the store cannot check",
            vec![(macro_authorization::USER_API_KEY_HEADER, "mk_unchecked")],
            "/login/passwordless",
        ),
    ] {
        assert_eq!(
            sign_in_with(None, false, &headers, uri).await.0,
            StatusCode::OK,
            "{who}"
        );
    }
}
