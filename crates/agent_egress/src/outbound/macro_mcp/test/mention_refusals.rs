//! Actual signed mention credentials must be refused before dispatching a write.
use super::*;
use agent_correlation::domain::{Correlation, CorrelationError, CorrelationRepository};
use agent_correlation::inbound::{CorrelationState, propagate};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    middleware,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use std::sync::Arc;
use tower::ServiceExt;

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

async fn refuses_before_dispatch(method: &str, path: &str) {
    refuses_signed_request_before_dispatch(
        SignedClaims::channel_mention(
            bot_id::MACRO_AI_BOT_ID.as_uuid(),
            uuid::Uuid::from_u128(902),
        ),
        method,
        path,
    )
    .await;
}

async fn refuses_signed_request_before_dispatch(claims: SignedClaims, method: &str, path: &str) {
    let signer = MacroApiTokenSigner::new(
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://fixture@127.0.0.1:1/unused")
            .unwrap(),
        "fixture",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
        )),
    );
    let bearer = signer
        .encode(60, claims, "fixture".into(), owner().to_string(), None)
        .unwrap();
    let dispatched = Arc::new(AtomicUsize::new(0));
    let effects = dispatched.clone();
    // Exercise the signed-token HTTP gate with a dispatch spy. Refusal must
    // happen before a handler could publish a property event or launch work.
    let jwt = JwtValidationArgs::testing_macro_token(
        "fixture",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
        )),
    );
    let app = Router::new()
        .fallback(move || {
            effects.fetch_add(1, Ordering::SeqCst);
            async { StatusCode::OK }
        })
        .layer(middleware::from_fn_with_state(
            CorrelationState {
                jwt,
                repository: Arc::new(NoCorrelations),
            },
            propagate,
        ));
    let unscoped = signer
        .encode(
            60,
            SignedClaims::routine(None, uuid::Uuid::from_u128(905), None),
            "fixture".into(),
            owner().to_string(),
            None,
        )
        .unwrap();
    for secondary in [false, true] {
        let mut request = Request::builder().method(method).uri(path);
        request = if secondary {
            request
                .header("authorization", format!("Bearer {unscoped}"))
                .header(
                    "cookie",
                    format!(
                        "{}={bearer}",
                        macro_auth::credential::access_token_cookie_name()
                    ),
                )
        } else {
            request.header("authorization", format!("Bearer {bearer}"))
        };
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            (response.status(), dispatched.load(Ordering::SeqCst)),
            (StatusCode::FORBIDDEN, 0),
            "{method} {path}, secondary={secondary}: a restricted credential must start no downstream work"
        );
    }
}

#[tokio::test]
async fn mention_refuses_direct_bot_assignee_before_any_handler_runs() {
    refuses_before_dispatch("PUT", "/properties/entities/document/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002").await;
}

#[tokio::test]
async fn mention_refuses_bulk_bot_assignees_before_any_handler_runs() {
    refuses_before_dispatch(
        "POST",
        "/properties/entities/document/00000000-0000-0000-0000-000000000001/options/bulk",
    )
    .await;
    refuses_before_dispatch("POST", "/properties/options/bulk").await;
}

#[tokio::test]
async fn mention_refuses_bot_assignee_option_before_any_handler_runs() {
    refuses_before_dispatch("POST", "/properties/entities/document/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/options/00000000-0000-0000-0000-000000000003").await;
}

#[tokio::test]
async fn mention_refuses_project_inherited_bot_assignees_before_any_handler_runs() {
    refuses_before_dispatch("PUT", "/properties/entities/project/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002").await;
}

#[tokio::test]
async fn mention_refuses_task_creation_with_assignees_before_any_handler_runs() {
    refuses_before_dispatch("POST", "/documents/create_task").await;
}

#[tokio::test]
async fn mention_refuses_exporting_a_document_permission_token() {
    refuses_before_dispatch(
        "POST",
        "/documents/permissions_token/00000000-0000-0000-0000-000000000001",
    )
    .await;
}

#[tokio::test]
async fn mention_refuses_pipedream_configuration_and_connection_tokens() {
    for (method, path) in [
        ("PUT", "/pipedream/mcp/connections"),
        ("DELETE", "/pipedream/mcp/connections"),
        ("POST", "/pipedream/mcp/token"),
        ("POST", "/pipedream/mcp/complete"),
        ("POST", "/pipedream/mcp/recover"),
        ("POST", "/pipedream/mcp/connect/complete"),
    ] {
        refuses_before_dispatch(method, path).await;
    }
}

#[tokio::test]
async fn mention_refuses_retargeting_or_deleting_a_webhook() {
    refuses_before_dispatch(
        "PATCH",
        "/webhook/webhooks/00000000-0000-0000-0000-000000000001",
    )
    .await;
    refuses_before_dispatch(
        "DELETE",
        "/webhook/webhooks/00000000-0000-0000-0000-000000000001",
    )
    .await;
}

#[tokio::test]
async fn mention_refuses_copying_or_restoring_a_skill() {
    refuses_before_dispatch(
        "POST",
        "/documents/00000000-0000-0000-0000-000000000001/copy",
    )
    .await;
    refuses_before_dispatch(
        "PUT",
        "/documents/00000000-0000-0000-0000-000000000001/revert_delete",
    )
    .await;
}

#[tokio::test]
async fn no_send_refuses_exporting_a_document_permission_token() {
    refuses_signed_request_before_dispatch(
        SignedClaims::routine(
            None,
            uuid::Uuid::from_u128(904),
            Some(agent_correlation::scope::SessionScope::NoSend),
        ),
        "POST",
        "/documents/permissions_token/00000000-0000-0000-0000-000000000001",
    )
    .await;
}

#[tokio::test]
async fn a_legacy_mention_without_a_scope_still_cannot_launch_work() {
    let mut claims = SignedClaims::channel_mention(
        bot_id::MACRO_AI_BOT_ID.as_uuid(),
        uuid::Uuid::from_u128(906),
    );
    claims.agent_scope = None;
    refuses_signed_request_before_dispatch(claims, "POST", "/documents/create_task").await;
}

#[tokio::test]
async fn a_legacy_mention_with_no_send_still_cannot_launch_work() {
    let mut claims = SignedClaims::channel_mention(
        bot_id::MACRO_AI_BOT_ID.as_uuid(),
        uuid::Uuid::from_u128(906),
    );
    claims.agent_scope = Some(agent_correlation::scope::SessionScope::NoSend);
    refuses_signed_request_before_dispatch(claims, "POST", "/documents/create_task").await;
}

#[tokio::test]
async fn no_send_refuses_configuration_that_background_suggestions_never_need() {
    for (method, path) in [
        ("PUT", "/pipedream/mcp/connections"),
        ("DELETE", "/pipedream/mcp/connections"),
        ("POST", "/pipedream/mcp/token"),
        ("POST", "/pipedream/mcp/complete"),
        ("POST", "/pipedream/mcp/recover"),
        ("POST", "/pipedream/mcp/connect/complete"),
        (
            "PATCH",
            "/webhook/webhooks/00000000-0000-0000-0000-000000000001",
        ),
        (
            "DELETE",
            "/webhook/webhooks/00000000-0000-0000-0000-000000000001",
        ),
    ] {
        refuses_signed_request_before_dispatch(
            SignedClaims::routine(
                None,
                uuid::Uuid::from_u128(904),
                Some(agent_correlation::scope::SessionScope::NoSend),
            ),
            method,
            path,
        )
        .await;
    }
}
