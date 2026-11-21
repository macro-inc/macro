//! Real mention signing, decoding and HTTP scope enforcement; no database calls.
use super::*;
use agent_correlation::domain::{Correlation, CorrelationError, CorrelationRepository};
use agent_correlation::inbound::{CorrelationState, propagate};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::get,
};
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs};
use tower::ServiceExt;

const PRIVATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
));
const PUBLIC: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
));
struct NoCorrelations;
#[async_trait::async_trait]
impl CorrelationRepository for NoCorrelations {
    async fn create(
        &self,
        _: uuid::Uuid,
        _: uuid::Uuid,
        _: Option<agent_correlation::scope::SessionScope>,
    ) -> Result<uuid::Uuid, CorrelationError> {
        unreachable!("mention credentials have no session")
    }
    async fn find(&self, _: uuid::Uuid) -> Result<Option<Correlation>, CorrelationError> {
        unreachable!("mention credentials have no correlation")
    }
}

#[tokio::test]
async fn audit_a_signed_mention_refuses_sends_and_persistent_instructions() {
    // connect_lazy only constructs a pool; identity lookup is not used here.
    let signer = MacroApiTokenSigner::new(
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://fixture@127.0.0.1:1/unused")
            .unwrap(),
        "fixture",
        PRIVATE,
    );
    let mention = uuid::Uuid::from_u128(901);
    let bearer = signer
        .encode(
            60,
            SignedClaims::channel_mention(bot_id::MACRO_AI_BOT_ID.as_uuid(), mention),
            "fixture".into(),
            owner().to_string(),
            None,
        )
        .unwrap();
    let jwt = JwtValidationArgs::testing_macro_token("fixture", PUBLIC);
    let JwtToken::MacroApiToken(decoded) =
        macro_auth::middleware::decode_jwt::handler(&jwt, &bearer).unwrap()
    else {
        panic!("expected Macro API token")
    };
    assert_eq!(decoded.channel_mention_id, Some(mention));
    assert_eq!(decoded.agent_id, Some(bot_id::MACRO_AI_BOT_ID.as_uuid()));
    let app = Router::new()
        .route(
            "/read",
            get(move || async move {
                assert_eq!(
                    agent_correlation::context::current_channel_mention(),
                    Some(mention)
                );
                StatusCode::OK
            }),
        )
        .fallback(|| async { StatusCode::OK })
        .layer(middleware::from_fn_with_state(
            CorrelationState {
                jwt,
                repository: Arc::new(NoCorrelations),
            },
            propagate,
        ));
    for (method, path) in [
        ("POST", "/call/meetings/invite/fixture"),
        ("POST", "/referral/send"),
        ("POST", "/channels/fixture/shares"),
        ("POST", "/channels/get_or_create_dm"),
        ("POST", "/channels/get_or_create_private"),
        ("POST", "/web/fetch"),
        ("PATCH", "/memory/explicit"),
        ("POST", "/scheduled-actions"),
        ("POST", "/agent-sessions"),
        ("POST", "/documents/create_skill"),
        ("PUT", "/documents/fixture/skill_description"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", format!("Bearer {bearer}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {path}");
    }
    let response = app
        .oneshot(
            Request::builder()
                .uri("/read")
                .header("authorization", format!("Bearer {bearer}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(decoded.agent_scope.as_deref(), Some("no_send"));
}
