use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header, request::Builder},
    routing::post,
};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use serde::Deserialize;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{AccessLevel, EditAccessLevel, EntityAccessAuth, EntityType, ViewAccessLevel},
    inbound::axum_extractors::test_support::{
        AccessCall, FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY, TestState,
        USER_ID,
    },
};

const ENTITY_ID: &str = "entity-1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestBody {
    entity_type: EntityType,
    entity_id: String,
    position: u32,
}

type ViewExtractor = EntityBodyAccessLevelExtractor<
    ViewAccessLevel,
    FakeEntityAccessService,
    TestBody,
    FakeAuthorizationService,
>;
type EditExtractor = EntityBodyAccessLevelExtractor<
    EditAccessLevel,
    FakeEntityAccessService,
    TestBody,
    FakeAuthorizationService,
>;

async fn view_handler(access: ViewExtractor) -> String {
    let auth = match access.entity_access_receipt.auth() {
        EntityAccessAuth::Authenticated(_) => "authenticated",
        EntityAccessAuth::Bot(_) => "bot",
        EntityAccessAuth::Unauthenticated => "unauthenticated",
        EntityAccessAuth::Internal => "internal",
    };
    let entity = access.entity_access_receipt.entity();

    format!(
        "{auth}:{}:{}:{}:{}:{}",
        entity.entity_type,
        entity.entity_id,
        access.inner.entity_type,
        access.inner.entity_id,
        access.inner.position
    )
}

async fn edit_handler(_access: EditExtractor) {}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/view", post(view_handler))
        .route("/edit", post(edit_handler))
        .with_state(state)
}

fn request(path: &str) -> Builder {
    Request::post(path).header(header::CONTENT_TYPE, "application/json")
}

fn body(entity_type: &str, entity_id: &str) -> Body {
    Body::from(format!(
        r#"{{"entityType":"{entity_type}","entityId":"{entity_id}","position":7}}"#
    ))
}

async fn response_body(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    String::from_utf8(body.to_vec()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn authenticated_access_uses_body_entity_and_preserves_typed_body() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(body("document", ENTITY_ID))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_body(response).await,
        "authenticated:document:entity-1:document:entity-1:7"
    );
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn acting_user_internal_access_uses_the_acting_users_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(INTERNAL_MACRO_USER_ID_HEADER, USER_ID)
                .body(body("document", ENTITY_ID))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_body(response).await,
        "authenticated:document:entity-1:document:entity-1:7"
    );
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn missing_identity_is_rejected_before_body_and_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request("/view").body(Body::from("{")).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_access_is_rejected_before_body_and_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn absent_access_is_rejected() {
    let state = TestState::new(None);
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(body("document", ENTITY_ID))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls().len(), 1);
}

#[tokio::test]
async fn view_access_does_not_satisfy_edit_access() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/edit")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(body("document", ENTITY_ID))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls().len(), 1);
}

#[tokio::test]
async fn missing_and_malformed_json_are_rejected_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));

    for invalid_body in [Body::empty(), Body::from("{")] {
        let response = router(state.clone())
            .oneshot(
                request("/view")
                    .header(header::AUTHORIZATION, "Bearer valid")
                    .body(invalid_body)
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn missing_entity_fields_are_rejected_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));

    for invalid_body in [
        Body::from(r#"{"entityId":"entity-1","position":7}"#),
        Body::from(r#"{"entityType":"document","position":7}"#),
    ] {
        let response = router(state.clone())
            .oneshot(
                request("/view")
                    .header(header::AUTHORIZATION, "Bearer valid")
                    .body(invalid_body)
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn unknown_entity_types_are_rejected_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(body("thread", ENTITY_ID))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn typed_body_failure_is_rejected_after_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request("/view")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::from(
                    r#"{"entityType":"document","entityId":"entity-1","position":"first"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn channels_and_static_files_keep_get_access_level_semantics() {
    let state = TestState::new(Some(AccessLevel::View));

    for (entity_type, entity_id) in [("channel", "channel-1"), ("static_file", "static-1")] {
        let response = router(state.clone())
            .oneshot(
                request("/view")
                    .header(header::AUTHORIZATION, "Bearer valid")
                    .body(body(entity_type, entity_id))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    assert_eq!(
        state.entity_access.calls(),
        [
            AccessCall {
                user_id: Some(USER_ID.to_string()),
                entity_id: "channel-1".to_string(),
                entity_type: EntityType::Channel,
            },
            AccessCall {
                user_id: Some(USER_ID.to_string()),
                entity_id: "static-1".to_string(),
                entity_type: EntityType::StaticFile,
            },
        ]
    );
}
