//! A program reads Macro's sign-in emails redacted; a person reads them whole.

use super::context::AuthorizationService;
use super::hide_sign_in_emails_from_programs;
use axum::{Json, Router, body::Body, http::Request, routing::get};
use macro_auth::{
    macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token},
    middleware::decode_jwt::JwtValidationArgs,
};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

/// A message route answering with one of Macro's sign-in emails.
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
    hide_sign_in_emails_from_programs(
        Router::new().route(
            "/email/messages/m1",
            get(|| async {
                Json(serde_json::json!({
                    "db_id": "m1",
                    "subject": "Log into Macro - 482913",
                    "from": {"email": "auth@macro.com", "name": "Macro"},
                    "body_text": "Here is your temporary login code: 482913",
                }))
            }),
        ),
        authorization,
    )
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

async fn read(bearer: &str, code_execution: bool) -> String {
    let mut request =
        Request::get("/email/messages/m1").header("authorization", format!("Bearer {bearer}"));
    if code_execution {
        request = request.header(macro_authorization::CODE_EXECUTION_HEADER, "1");
    }
    let response = router()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    String::from_utf8_lossy(&body).into_owned()
}

#[tokio::test]
async fn a_program_never_reads_a_sign_in_code() {
    let person = token(None, None);
    for (program, body) in [
        (
            "an agent run",
            read(&token(Some(Uuid::from_u128(1)), None), false).await,
        ),
        (
            "an owner-identity routine run",
            read(&token(None, Some(Uuid::from_u128(2))), false).await,
        ),
        ("the code-mode runtime", read(&person, true).await),
    ] {
        assert!(!body.contains("482913"), "{program}: {body}");
        assert!(body.contains("\"db_id\":\"m1\""), "{program}: {body}");
    }
}

#[tokio::test]
async fn a_person_reads_their_sign_in_email() {
    let body = read(&token(None, None), false).await;
    assert!(body.contains("482913"), "{body}");
}
