use std::collections::HashSet;

use axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{Request, StatusCode},
    routing::get,
};
use http_body_util::BodyExt;
use macro_authorization::{
    MacroAuthorizationError, MacroAuthorizationServiceHandle, UserPermissionsServiceHandle,
    testing::{FakeMacroAuthorizationService, bearer, test_user_context},
};
use macro_user_id::user_id::BorrowedUserIdStr;
use roles_and_permissions::domain::{
    model::{PermissionId, UserRolesAndPermissionsError},
    port::UserPermissionsService,
};
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;

const TEST_USER_ID: &str = "macro|chat-model-access@example.com";

#[derive(Clone)]
struct FakeUserPermissionsService {
    permissions: HashSet<PermissionId>,
    should_fail: bool,
}

impl FakeUserPermissionsService {
    fn returning(permissions: impl IntoIterator<Item = PermissionId>) -> Self {
        Self {
            permissions: permissions.into_iter().collect(),
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            permissions: HashSet::new(),
            should_fail: true,
        }
    }
}

impl UserPermissionsService for FakeUserPermissionsService {
    async fn get_user_permissions_for_user_id(
        &self,
        _user_id: &BorrowedUserIdStr<'_>,
    ) -> Result<HashSet<PermissionId>, UserRolesAndPermissionsError> {
        if self.should_fail {
            return Err(UserRolesAndPermissionsError::UserDoesNotExist);
        }

        Ok(self.permissions.clone())
    }
}

#[derive(Clone)]
struct TestState {
    authorization: MacroAuthorizationServiceHandle,
    permissions: UserPermissionsServiceHandle,
}

impl FromRef<TestState> for MacroAuthorizationServiceHandle {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

impl FromRef<TestState> for UserPermissionsServiceHandle {
    fn from_ref(state: &TestState) -> Self {
        state.permissions.clone()
    }
}

async fn model_access_handler(access: ChatModelAccess) -> Json<Value> {
    Json(json!({
        "professional": access.professional(),
        "bestModel": access.best_model(),
        "paidModelAllowed": access.has_access("anthropic/claude-opus-4-8"),
    }))
}

fn test_router(
    authorization: FakeMacroAuthorizationService,
    permissions: FakeUserPermissionsService,
) -> Router {
    Router::new()
        .route("/model-access", get(model_access_handler))
        .with_state(TestState {
            authorization: MacroAuthorizationServiceHandle::new(authorization),
            permissions: UserPermissionsServiceHandle::new(permissions),
        })
}

async fn send(router: Router, token: &str) -> (StatusCode, Value) {
    let request = bearer(Request::get("/model-access"), token)
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, body)
}

fn access(permissions: &[PermissionId]) -> ChatModelAccess {
    ChatModelAccess {
        professional: permissions.contains(&PermissionId::ReadProfessionalFeatures),
    }
}

#[test]
fn free_user_defaults_to_haiku_and_only_has_haiku() {
    let free = access(&[]);
    assert_eq!(free.best_model(), FREE_MODEL);
    assert!(free.has_access(FREE_MODEL));
    assert!(!free.has_access("anthropic/claude-opus-4-8"));
}

#[test]
fn professional_user_defaults_to_smart_and_has_everything() {
    let professional = access(&[PermissionId::ReadProfessionalFeatures]);
    assert_eq!(professional.best_model(), "anthropic/claude-opus-4-8");
    assert!(professional.has_access("anthropic/claude-opus-4-8"));
    assert!(professional.has_access(FREE_MODEL));
    assert!(professional.has_access("openai/gpt-5.5"));
}

#[test]
fn unrelated_permissions_stay_free() {
    let model_access = access(&[PermissionId::WriteEmailTool, PermissionId::ReadDocxEditor]);
    assert!(!model_access.professional());
    assert!(!model_access.has_access("anthropic/claude-opus-4-8"));
}

#[tokio::test]
async fn extraction_uses_typed_professional_permission() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));

    let free_router = test_router(
        authorization.clone(),
        FakeUserPermissionsService::returning([]),
    );
    let professional_router = test_router(
        authorization,
        FakeUserPermissionsService::returning([PermissionId::ReadProfessionalFeatures]),
    );

    let (free_status, free_body) = send(free_router, "free").await;
    let (professional_status, professional_body) = send(professional_router, "professional").await;

    assert_eq!(free_status, StatusCode::OK);
    assert_eq!(
        free_body,
        json!({
            "professional": false,
            "bestModel": FREE_MODEL,
            "paidModelAllowed": false,
        })
    );
    assert_eq!(professional_status, StatusCode::OK);
    assert_eq!(
        professional_body,
        json!({
            "professional": true,
            "bestModel": "anthropic/claude-opus-4-8",
            "paidModelAllowed": true,
        })
    );
}

#[tokio::test]
async fn permission_lookup_failure_returns_json_internal_error() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));
    let router = test_router(authorization, FakeUserPermissionsService::failing());

    let (status, body) = send(router, "valid").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({ "message": "internal server error" }));
}

#[tokio::test]
async fn credential_rejection_is_propagated_unchanged() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let router = test_router(
        authorization,
        FakeUserPermissionsService::returning([PermissionId::ReadProfessionalFeatures]),
    );

    let (status, body) = send(router, "expired").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "jwt expired" }));
}
