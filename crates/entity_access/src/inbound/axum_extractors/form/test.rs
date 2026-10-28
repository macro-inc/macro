use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use macro_authorization::INTERNAL_API_KEY_HEADER;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{EditAccessLevel, EntityAccessAuth, ViewAccessLevel},
    inbound::axum_extractors::test_support::{
        AccessCall, FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY, TestState,
        USER_ID,
    },
};

const FORM_ID: &str = "0199b1f2-6b3a-7f1a-9c2a-2f0d5c2a8f11";

type ViewExtractor =
    FormAccessLevelExtractor<ViewAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;
type EditExtractor =
    FormAccessLevelExtractor<EditAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;

fn describe<Permission: RequiredPermission>(receipt: &EntityAccessReceipt<Permission>) -> String {
    let auth = match receipt.auth() {
        EntityAccessAuth::Authenticated(user_id) => user_id.as_ref().to_string(),
        EntityAccessAuth::Unauthenticated => "unauthenticated".to_string(),
        EntityAccessAuth::Internal => "internal".to_string(),
        EntityAccessAuth::Bot(_) => "bot".to_string(),
    };
    let level = match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => access_level.to_string(),
        other => format!("{other:?}"),
    };
    format!("{}:{auth}:{level}", receipt.entity().entity_type)
}

async fn view_handler(extracted: ViewExtractor) -> String {
    describe(&extracted.entity_access_receipt)
}

async fn edit_handler(extracted: EditExtractor) -> String {
    describe(&extracted.entity_access_receipt)
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/forms/{id}", get(view_handler))
        .route("/forms/{id}/layout", get(edit_handler))
        .route("/forms", get(view_handler))
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
async fn an_anonymous_respondent_on_a_public_form_gets_an_unauthenticated_view_receipt() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}"), None))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "form:unauthenticated:view");
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: None,
            entity_id: FORM_ID.to_string(),
            entity_type: EntityType::Form,
        }]
    );
}

#[tokio::test]
async fn an_anonymous_request_on_a_members_form_is_rejected() {
    let state = TestState::new(None);
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}"), None))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: None,
            entity_id: FORM_ID.to_string(),
            entity_type: EntityType::Form,
        }]
    );
}

#[tokio::test]
async fn an_anonymous_request_never_meets_edit() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}/layout"), None))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_anonymous_request_never_meets_edit_even_if_the_service_overstates() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}/layout"), None))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn a_signed_in_editor_gets_an_authenticated_receipt_at_their_level() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}/layout"), Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_body(response).await,
        format!("form:{USER_ID}:edit")
    );
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: FORM_ID.to_string(),
            entity_type: EntityType::Form,
        }]
    );
}

#[tokio::test]
async fn a_signed_in_viewer_cannot_edit() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}/layout"), Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_signed_in_stranger_is_rejected() {
    let state = TestState::new(None);
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}"), Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_internal_caller_without_a_user_is_trusted_as_owner() {
    let state = TestState::new(None);
    let response = router(state.clone())
        .oneshot(
            Request::get(format!("/forms/{FORM_ID}/layout"))
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "form:internal:owner");
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn missing_id_path_parameter_is_a_bad_request() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(request("/forms", Some("valid")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn an_expired_token_is_not_treated_as_anonymous() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request(&format!("/forms/{FORM_ID}"), Some("expired")))
        .await
        .expect("router should respond");

    assert_ne!(response.status(), StatusCode::OK);
    assert!(state.entity_access.calls().is_empty());
}
