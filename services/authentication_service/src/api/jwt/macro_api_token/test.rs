use super::*;
use crate::api::context::{MacroApiTokenIssuer, MacroApiTokenPrivateSecretKey};
use axum::{Router, body::Body, extract::FromRef, http::Request, routing::get};
use macro_auth::{
    macro_api_token::encode_macro_api_token, middleware::decode_jwt::JwtValidationArgs,
};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationState,
    PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use remote_env_var::LocalOrRemoteSecret;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const PRIVATE: &str = include_str!(
    "../../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

#[derive(Clone)]
struct State {
    db: PgPool,
    tokens: MacroApiTokenContext,
    authorization: MacroAuthorizationState<AuthorizationService>,
}

impl FromRef<State> for PgPool {
    fn from_ref(state: &State) -> Self {
        state.db.clone()
    }
}

impl FromRef<State> for MacroApiTokenContext {
    fn from_ref(state: &State) -> Self {
        state.tokens.clone()
    }
}

impl FromRef<State> for MacroAuthorizationState<AuthorizationService> {
    fn from_ref(state: &State) -> Self {
        state.authorization.clone()
    }
}

/// The route over a database it never reaches: a refused request answers
/// before the profile lookup, so an admitted one fails on the connection.
fn router() -> Router {
    let db = PgPool::connect_lazy("postgres://nobody@127.0.0.1:1/none").unwrap();
    let authorization = MacroAuthorizationState::new(Arc::new(AuthorizationService::new(
        MacroAuthJwtValidator::new(JwtValidationArgs::testing_macro_token("fixture", PUBLIC)),
        InternalAuthConfig {
            api_key: "test-internal-key".to_owned(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(db.clone())),
    )));
    Router::new()
        .route("/jwt/macro_api_token", get(handler))
        .with_state(State {
            db,
            tokens: MacroApiTokenContext {
                issuer: MacroApiTokenIssuer::Comptime("fixture"),
                macro_api_token_private_key: LocalOrRemoteSecret::Local(
                    MacroApiTokenPrivateSecretKey::Comptime(PRIVATE),
                ),
                expiry_seconds: 3600,
            },
            authorization,
        })
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

async fn mint_with(bearer: &str, code_execution: bool) -> (StatusCode, String) {
    let mut request =
        Request::get("/jwt/macro_api_token").header("authorization", format!("Bearer {bearer}"));
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

async fn mint(bearer: &str) -> StatusCode {
    mint_with(bearer, false).await.0
}

/// A program's 60-second run credential must not become an hour-long token
/// it can return, so a credential signed for an agent or a routine run is
/// refused before anything is minted.
#[tokio::test]
async fn a_programs_credential_cannot_mint_a_longer_lived_token() {
    for (program, bearer) in [
        ("an agent run", token(Some(Uuid::from_u128(1)), None)),
        (
            "an owner-identity routine run",
            token(None, Some(Uuid::from_u128(2))),
        ),
    ] {
        assert_eq!(mint(&bearer).await, StatusCode::FORBIDDEN, "{program}");
    }
    let (status, _) = mint_with(&token(None, None), true).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "the code-mode runtime's header"
    );
}

#[tokio::test]
async fn a_persons_credential_reaches_the_profile_lookup() {
    // The lookup fails on the unreachable database: the request was admitted.
    let (status, body) = mint_with(&token(None, None), false).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body.contains("unable to get user profile"), "{body}");
}
