use std::sync::{Arc, Mutex};

use ::axum::{
    Json, Router,
    body::Body,
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::get,
};
use http_body_util::BodyExt;
use roles_and_permissions::domain::port::UserPermissionsService;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::{
    MacroAuthorizationError, SharedMacroAuthorizationService,
    testing::{FakeMacroAuthorizationService, bearer, test_user_context},
};

const USER_ID: &str = "macro|permissions@example.com";
const MIXED_CASE_USER_ID: &str = "macro|MixedCase@User.com";

#[derive(Clone)]
struct FakeUserPermissionsService {
    calls: Arc<Mutex<Vec<String>>>,
    permissions: HashSet<PermissionId>,
    should_fail: bool,
}

impl FakeUserPermissionsService {
    fn returning(permissions: HashSet<PermissionId>) -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            permissions,
            should_fail: false,
        }
    }

    fn failing() -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            permissions: HashSet::new(),
            should_fail: true,
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .expect("fake permissions calls lock poisoned")
            .clone()
    }
}

impl UserPermissionsService for FakeUserPermissionsService {
    async fn get_user_permissions_for_user_id(
        &self,
        user_id: &BorrowedUserIdStr<'_>,
    ) -> Result<HashSet<PermissionId>, UserRolesAndPermissionsError> {
        self.calls
            .lock()
            .expect("fake permissions calls lock poisoned")
            .push(user_id.0.as_ref().to_string());

        if self.should_fail {
            return Err(UserRolesAndPermissionsError::UserDoesNotExist);
        }

        Ok(self.permissions.clone())
    }
}

#[derive(Clone)]
struct TestState {
    authorization: SharedMacroAuthorizationService,
    permissions: SharedUserPermissionsService,
}

impl FromRef<TestState> for SharedMacroAuthorizationService {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

impl FromRef<TestState> for SharedUserPermissionsService {
    fn from_ref(state: &TestState) -> Self {
        state.permissions.clone()
    }
}

async fn permissioned_handler(
    authorization: PermissionedMacroAuthorizationExtractor,
) -> Json<Value> {
    let mut permissions = authorization
        .permissions
        .into_iter()
        .map(|permission| permission.to_string())
        .collect::<Vec<_>>();
    permissions.sort();

    Json(json!({
        "macro_user_id": authorization.macro_user_id.to_string(),
        "user_context_id": authorization.user_context.user_id,
        "permissions": permissions,
    }))
}

fn test_router(
    authorization: FakeMacroAuthorizationService,
    permissions: FakeUserPermissionsService,
) -> Router {
    Router::new()
        .route("/permissioned", get(permissioned_handler))
        .with_state(TestState {
            authorization: SharedMacroAuthorizationService::new(authorization),
            permissions: SharedUserPermissionsService::new(permissions),
        })
}

async fn send(router: Router, token: &str) -> (StatusCode, axum::http::HeaderMap, Value) {
    let request = bearer(Request::get("/permissioned"), token)
        .body(Body::empty())
        .unwrap();
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, headers, body)
}

#[tokio::test]
async fn credential_rejection_is_delegated_unchanged() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let permissions = FakeUserPermissionsService::returning(HashSet::new());
    let router = test_router(authorization, permissions.clone());

    let (status, headers, body) = send(router, "expired").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, json!({ "message": "jwt expired" }));
    assert_eq!(
        headers.get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    assert!(permissions.calls().is_empty());
}

#[tokio::test]
async fn permission_lookup_failure_returns_json_internal_error() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(USER_ID));
    let permissions = FakeUserPermissionsService::failing();
    let router = test_router(authorization, permissions.clone());

    let (status, _, body) = send(router, "valid").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body, json!({ "message": "internal server error" }));
    assert_eq!(permissions.calls(), [USER_ID]);
}

#[tokio::test]
async fn extraction_returns_typed_permissions() {
    let authorization = FakeMacroAuthorizationService::always(test_user_context(USER_ID));
    let permissions = FakeUserPermissionsService::returning(HashSet::from([
        PermissionId::ReadProfessionalFeatures,
        PermissionId::WriteProAi,
    ]));
    let router = test_router(authorization, permissions.clone());

    let (status, _, body) = send(router, "valid").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["permissions"],
        json!(["read:professional_features", "write:proai"])
    );
    assert_eq!(permissions.calls(), [USER_ID]);
}

#[tokio::test]
async fn permission_lookup_uses_original_user_id_casing() {
    let authorization =
        FakeMacroAuthorizationService::always(test_user_context(MIXED_CASE_USER_ID));
    let permissions = FakeUserPermissionsService::returning(HashSet::new());
    let router = test_router(authorization, permissions.clone());

    let (status, _, body) = send(router, "valid").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["macro_user_id"], "macro|mixedcase@user.com");
    assert_eq!(body["user_context_id"], MIXED_CASE_USER_ID);
    assert_eq!(permissions.calls(), [MIXED_CASE_USER_ID]);
}
