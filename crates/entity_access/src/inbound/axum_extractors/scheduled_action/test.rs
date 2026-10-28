use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
    routing::put,
};
use macro_authorization::{BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotScope, INTERNAL_API_KEY_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{
        AccessLevel, BotAccessScope, EditAccessLevel, EntityPermission, OwnerAccessLevel,
        ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BotAccessCall,
        FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY, TestState, USER_ID,
        VALID_BOT_TOKEN,
    },
};

const ACTION_ID: &str = "11111111-1111-4111-8111-111111111111";

type EditExtractor = ScheduledActionAccessExtractor<
    EditAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type OwnerExtractor = ScheduledActionAccessExtractor<
    OwnerAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type ViewExtractor = ScheduledActionAccessExtractor<
    ViewAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

fn user_request() -> Request<Body> {
    Request::put(format!("/scheduled-actions/{ACTION_ID}"))
        .header(header::AUTHORIZATION, "Bearer valid")
        .body(Body::empty())
        .unwrap()
}

async fn status(app: Router, request: Request<Body>) -> StatusCode {
    app.oneshot(request).await.unwrap().status()
}

fn assert_authenticated(auth: &EntityAccessAuth) {
    assert!(matches!(
        auth,
        EntityAccessAuth::Authenticated(user) if user.as_ref() == USER_ID
    ));
}

#[tokio::test]
async fn edit_route_accepts_edit_and_owner_and_rejects_view() {
    for (level, expected) in [
        (AccessLevel::Edit, StatusCode::NO_CONTENT),
        (AccessLevel::Owner, StatusCode::NO_CONTENT),
        (AccessLevel::View, StatusCode::UNAUTHORIZED),
    ] {
        let state = TestState::new(Some(level));
        let app = Router::new()
            .route(
                "/scheduled-actions/{id}",
                put(move |access: EditExtractor| async move {
                    assert_authenticated(access.entity_access_receipt.auth());
                    assert_eq!(
                        access.entity_access_receipt.entity_permission(),
                        &EntityPermission::AccessLevel {
                            access_level: level
                        }
                    );
                    StatusCode::NO_CONTENT
                }),
            )
            .with_state(state);
        assert_eq!(status(app, user_request()).await, expected, "{level:?}");
    }
}

#[tokio::test]
async fn owner_route_rejects_edit() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|_access: OwnerExtractor| async { StatusCode::NO_CONTENT }),
        )
        .with_state(state);
    assert_eq!(status(app, user_request()).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn view_route_accepts_view() {
    let state = TestState::new(Some(AccessLevel::View));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|access: ViewExtractor| async move {
                assert_authenticated(access.entity_access_receipt.auth());
                assert_eq!(
                    access.entity_access_receipt.entity_permission(),
                    &EntityPermission::AccessLevel {
                        access_level: AccessLevel::View
                    }
                );
                StatusCode::NO_CONTENT
            }),
        )
        .with_state(state);
    assert_eq!(status(app, user_request()).await, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn missing_grant_is_unauthorized() {
    let state = TestState::new(None);
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|_access: ViewExtractor| async { StatusCode::NO_CONTENT }),
        )
        .with_state(state);
    assert_eq!(status(app, user_request()).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn anonymous_is_unauthorized_without_a_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|_access: ViewExtractor| async { StatusCode::NO_CONTENT }),
        )
        .with_state(state.clone());
    let request = Request::put(format!("/scheduled-actions/{ACTION_ID}"))
        .body(Body::empty())
        .unwrap();

    assert_eq!(status(app, request).await, StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls(), []);
    assert_eq!(state.entity_access.bot_calls(), []);
}

#[tokio::test]
async fn user_scoped_bot_uses_scheduled_action_bot_receipt() {
    let state = TestState::new(Some(AccessLevel::View));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|access: ViewExtractor| async move {
                assert!(matches!(
                    access.entity_access_receipt.auth(),
                    EntityAccessAuth::Bot(_)
                ));
                assert_eq!(
                    access.entity_access_receipt.entity_permission(),
                    &EntityPermission::AccessLevel {
                        access_level: AccessLevel::View
                    }
                );
                StatusCode::NO_CONTENT
            }),
        )
        .with_state(state.clone());
    let request = Request::put(format!("/scheduled-actions/{ACTION_ID}"))
        .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
        .body(Body::empty())
        .unwrap();

    assert_eq!(status(app, request).await, StatusCode::NO_CONTENT);
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID).expect("acting user"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: ACTION_ID.to_string(),
            entity_type: EntityType::ScheduledAction,
        }]
    );
    assert_eq!(state.entity_access.calls(), []);
}

#[tokio::test]
async fn internal_without_user_is_unauthorized_without_a_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|_access: ViewExtractor| async { StatusCode::NO_CONTENT }),
        )
        .with_state(state.clone());
    let request = Request::put(format!("/scheduled-actions/{ACTION_ID}"))
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .unwrap();

    assert_eq!(status(app, request).await, StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls(), []);
    assert_eq!(state.entity_access.bot_calls(), []);
}

#[tokio::test]
async fn malformed_id_is_bad_request() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let app = Router::new()
        .route(
            "/scheduled-actions/{id}",
            put(|_access: ViewExtractor| async { StatusCode::NO_CONTENT }),
        )
        .with_state(state.clone());
    let request = Request::put("/scheduled-actions/not-a-uuid")
        .header(header::AUTHORIZATION, "Bearer valid")
        .body(Body::empty())
        .unwrap();

    assert_eq!(status(app, request).await, StatusCode::BAD_REQUEST);
    assert_eq!(state.entity_access.calls(), []);
}
