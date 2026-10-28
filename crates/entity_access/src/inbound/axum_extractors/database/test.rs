use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{EditAccessLevel, EntityAccessAuth},
    inbound::axum_extractors::test_support::{
        AccessCall, FakeAuthorizationService, FakeEntityAccessService, TestState, USER_ID,
    },
};

const DATABASE_ID: &str = "3b9c0f6c-6b3a-4f1a-9c2a-2f0d5c2a8f11";

type EditExtractor = DatabaseAccessLevelExtractor<
    EditAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

async fn handler(extracted: EditExtractor) -> String {
    let receipt = extracted.entity_access_receipt;
    let auth = match receipt.auth() {
        EntityAccessAuth::Authenticated(user_id) => user_id.as_ref().to_string(),
        EntityAccessAuth::Unauthenticated => "unauthenticated".to_string(),
        EntityAccessAuth::Internal => "internal".to_string(),
        EntityAccessAuth::Bot(_) => "bot".to_string(),
    };

    format!("{}:{}", receipt.entity().entity_type, auth)
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/databases/{id}", get(handler))
        .with_state(state)
}

/// A route whose path has no `id` segment, so the extractor cannot find the
/// parameter it needs.
fn router_without_id(state: TestState) -> Router {
    Router::new()
        .route("/databases", get(handler))
        .with_state(state)
}

fn request(path: &str, token: Option<&str>) -> Request<Body> {
    let mut request = Request::get(path);
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request
        .body(Body::empty())
        .expect("request should be valid")
}

async fn response_body(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    String::from_utf8(body.to_vec()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn missing_id_path_parameter_is_a_bad_request() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router_without_id(state.clone())
        .oneshot(request("/databases", Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn unauthenticated_request_is_rejected_without_an_access_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(request(&format!("/databases/{DATABASE_ID}"), None))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn insufficient_permission_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request(&format!("/databases/{DATABASE_ID}"), Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: DATABASE_ID.to_string(),
            entity_type: EntityType::Database,
        }]
    );
}

#[tokio::test]
async fn owner_receives_a_database_receipt() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(request(&format!("/databases/{DATABASE_ID}"), Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, format!("database:{USER_ID}"));
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: DATABASE_ID.to_string(),
            entity_type: EntityType::Database,
        }]
    );
}
