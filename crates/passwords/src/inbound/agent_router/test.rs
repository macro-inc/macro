use super::*;
use crate::{
    domain::agent::{DirectoryAgent, test::vault},
    inbound::router::test::Authorization,
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use std::sync::atomic::Ordering;
use tower::ServiceExt;

const PATH: &str = "/teams/00000000-0000-0000-0000-00000000007e/items/00000000-0000-0000-0000-000000000001/disclose";
/// The fake authorization's user for every non-agent token, including "key".
const KEY_USER: &str = "macro|synthetic@example.test";

async fn send(
    app: Router,
    token: &str,
    wake: Option<&str>,
    body: &'static str,
) -> (StatusCode, serde_json::Value, Option<String>) {
    let mut request = Request::post(PATH)
        .header("authorization", format!("Bearer {token}"))
        .header("x-macro-passwords", "1")
        .header("content-type", "application/json");
    if let Some(wake) = wake {
        request = request.header(WAKE_HEADER, wake);
    }
    let response = app
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let cache = response
        .headers()
        .get(CACHE_CONTROL)
        .map(|value| value.to_str().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap(), cache)
}

fn app(vault: crate::domain::agent::test::Vault) -> Router {
    agent_router(AgentRouterState {
        service: Arc::new(vault.service),
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
    })
}

#[tokio::test]
async fn flags_off_masks_malformed_bodies_and_wake_as_not_found() {
    let vault = vault();
    vault.availability.enabled.store(false, Ordering::SeqCst);
    let directory = vault.directory.clone();
    let (status, body, cache) = send(app(vault), "key", None, "{not json").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, serde_json::json!({"code": "not_found"}));
    assert_eq!(cache.as_deref(), Some("private, no-store"));
    assert_eq!(directory.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn only_user_api_keys_reach_agent_routes() {
    for token in ["session", "api", "agent", "internal"] {
        let (status, body, _) = send(app(vault()), token, None, "{}").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{token}");
        assert_eq!(body, serde_json::json!({"code": "unauthorized"}));
    }
}

#[tokio::test]
async fn typed_failures_keep_their_codes() {
    // The directory knows a different agent than the key's user.
    let (status, body, _) = send(app(vault()), "key", None, "{}").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, serde_json::json!({"code": "invalid_agent"}));

    // An admitted key with a bad wake keeps its specific 400 code.
    let admitted = vault();
    *admitted.directory.agent.lock().unwrap() = Some(DirectoryAgent {
        agent_user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(KEY_USER)
            .unwrap()
            .into_owned(),
        team_id: TeamId(Uuid::from_u128(0x7e)),
        owner_user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(KEY_USER)
            .unwrap()
            .into_owned(),
        enabled: true,
        computer_live: true,
    });
    let (status, body, _) = send(app(admitted), "key", Some("not-a-uuid"), "{}").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        serde_json::json!({"code": "invalid_session_attribution"})
    );
}

async fn json(app: Router, request: Request<Body>) -> (StatusCode, serde_json::Value) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 16).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn flags_off_masks_an_oversized_body_as_not_found() {
    let vault = vault();
    vault.availability.enabled.store(false, Ordering::SeqCst);
    let request = Request::post(PATH)
        .header("authorization", "Bearer key")
        .header("x-macro-passwords", "1")
        .header("content-type", "application/json")
        .body(Body::from(vec![b' '; BODY_LIMIT + 1]))
        .unwrap();
    let (status, body) = json(app(vault), request).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, serde_json::json!({"code": "not_found"}));
}

#[tokio::test]
async fn a_missing_csrf_header_is_a_typed_forbidden() {
    let request = Request::post(PATH)
        .header("authorization", "Bearer key")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let (status, body) = json(app(vault()), request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, serde_json::json!({"code": "forbidden"}));
}
