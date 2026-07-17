use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, EntityAccessAuth, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
#[allow(deprecated)]
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, JwtValidator, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    MacroAuthorizationError, MacroAuthorizationExtractor, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, ValidatedIdentity,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    PropertiesRouterState, PropertyTeamExtractor,
    extract::{EditReceiptExtractor, ViewReceiptExtractor},
};
use crate::{
    PropertiesServiceImpl,
    domain::ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo},
};

const DEFAULT_INTERNAL_USER_ID: &str = "macro|internal@macro.com";
const INTERNAL_API_KEY: &str = "test-internal-key";
const ORGANIZATION_ID: i32 = 42;
const VALID_USER_ID: &str = "macro|valid@example.com";

type TestPropertiesService =
    PropertiesServiceImpl<MockPropertiesRepo, MockPermissionService, MockNotificationService>;
type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

#[derive(Clone, Debug, PartialEq)]
enum AccessCall {
    GenerateReceipt {
        user_id: String,
        organization_id: Option<i64>,
        entity_id: String,
        entity_type: EntityType,
    },
    PublicAccess {
        entity_id: String,
        entity_type: EntityType,
        required_level: AccessLevel,
    },
    UserTeam {
        user_id: String,
    },
}

#[derive(Clone, Debug, Default)]
struct FakeEntityAccessService {
    calls: Arc<Mutex<Vec<AccessCall>>>,
}

impl FakeEntityAccessService {
    fn calls(&self) -> Vec<AccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }

    fn record(&self, call: AccessCall) {
        self.calls.lock().expect("calls lock poisoned").push(call);
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.record(AccessCall::GenerateReceipt {
            user_id: user_id.as_ref().to_string(),
            organization_id: user_org_id,
            entity_id: entity_id.to_string(),
            entity_type,
        });

        let user_id = MacroUserIdStr::try_from(user_id.as_ref().to_string())
            .expect("authorized test user id should be valid");
        Ok(EntityAccessReceipt::dangerously_assert_authenticated_user(
            user_id,
            entity_id,
            entity_type,
        ))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected bot receipt request")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected access-level request")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected authenticated access check")
    }

    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        self.record(AccessCall::PublicAccess {
            entity_id: entity_id.to_string(),
            entity_type,
            required_level,
        });
        Ok(AccessLevel::View)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected entity-permission request")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        panic!("unexpected CRM permission request")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected entity-users request")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected call-channel request")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected channel-call request")
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        self.record(AccessCall::UserTeam {
            user_id: user_id.as_ref().to_string(),
        });
        Ok(None)
    }
}

#[derive(Clone, Copy)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(ValidatedIdentity {
                user_id: VALID_USER_ID.to_string(),
                fusion_user_id: "fusion-valid-user".to_string(),
                organization_id: Some(ORGANIZATION_ID),
                permissions: None,
            }),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

fn no_op_properties_service() -> TestPropertiesService {
    PropertiesServiceImpl::new(
        MockPropertiesRepo::new(),
        None::<MockPermissionService>,
        None::<MockNotificationService>,
    )
}

fn authorization_state() -> MacroAuthorizationState<TestAuthorizationService> {
    let service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_API_KEY.to_string(),
            default_user_id: Some(DEFAULT_INTERNAL_USER_ID.to_string()),
        },
    );
    MacroAuthorizationState::new(Arc::new(service))
}

fn test_router(entity_access_service: FakeEntityAccessService) -> Router {
    let state = PropertiesRouterState::new(
        Arc::new(no_op_properties_service()),
        Arc::new(entity_access_service),
        authorization_state(),
    );

    Router::new()
        .route("/required", get(required_auth_handler))
        .route("/team", get(team_handler))
        .route("/view/{entity_type}/{entity_id}", get(view_handler))
        .route("/edit/{entity_type}/{entity_id}", get(edit_handler))
        .with_state(state)
}

async fn required_auth_handler(
    authorization: MacroAuthorizationExtractor<TestAuthorizationService>,
) -> String {
    authorization.macro_user_id.to_string()
}

async fn team_handler(
    team: PropertyTeamExtractor<FakeEntityAccessService, TestAuthorizationService>,
) -> &'static str {
    if team.entity_access_receipt.is_some() {
        "team"
    } else {
        "no-team"
    }
}

async fn view_handler(ViewReceiptExtractor(receipt): ViewReceiptExtractor) -> &'static str {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(_) => "authenticated",
        EntityAccessAuth::Unauthenticated => "unauthenticated",
        EntityAccessAuth::Bot(_) => "bot",
        EntityAccessAuth::Internal => "internal",
    }
}

async fn edit_handler(EditReceiptExtractor(_receipt): EditReceiptExtractor) -> StatusCode {
    StatusCode::OK
}

fn request(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("request should be valid")
}

fn bearer_request(uri: &str, token: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
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
async fn required_auth_rejects_bad_credentials_and_accepts_valid_bearer() {
    let router = test_router(FakeEntityAccessService::default());

    let response = router
        .clone()
        .oneshot(request("/required"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"unauthorized"}"#
    );

    let response = router
        .clone()
        .oneshot(bearer_request("/required", "invalid"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"unauthorized"}"#
    );

    let response = router
        .clone()
        .oneshot(bearer_request("/required", "expired"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"jwt expired"}"#
    );

    let response = router
        .oneshot(bearer_request("/required", "valid"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, VALID_USER_ID);
}

#[tokio::test]
async fn property_team_extractor_uses_authorized_user() {
    let entity_access_service = FakeEntityAccessService::default();
    let response = test_router(entity_access_service.clone())
        .oneshot(bearer_request("/team", "valid"))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "no-team");
    assert_eq!(
        entity_access_service.calls(),
        [AccessCall::UserTeam {
            user_id: VALID_USER_ID.to_string(),
        }]
    );
}

#[allow(deprecated)]
#[tokio::test]
async fn standard_and_legacy_internal_headers_use_the_default_user() {
    for key_header in [INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_API_KEY_HEADER] {
        let request = Request::builder()
            .uri("/required")
            .header(key_header, INTERNAL_API_KEY)
            .body(Body::empty())
            .expect("request should be valid");
        let response = test_router(FakeEntityAccessService::default())
            .oneshot(request)
            .await
            .expect("request should complete");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response_body(response).await, DEFAULT_INTERNAL_USER_ID);
    }
}

#[tokio::test]
async fn anonymous_view_mints_public_receipt_but_invalid_token_is_rejected() {
    let entity_access_service = FakeEntityAccessService::default();
    let router = test_router(entity_access_service.clone());

    let response = router
        .clone()
        .oneshot(request("/view/DOCUMENT/public-document"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "unauthenticated");
    assert_eq!(
        entity_access_service.calls(),
        [AccessCall::PublicAccess {
            entity_id: "public-document".to_string(),
            entity_type: EntityType::Document,
            required_level: AccessLevel::View,
        }]
    );

    let response = router
        .oneshot(bearer_request("/view/DOCUMENT/public-document", "invalid"))
        .await
        .expect("request should complete");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response_body(response).await, "unauthorized");
    assert_eq!(
        entity_access_service.calls().len(),
        1,
        "invalid credentials must not fall back to public authorization"
    );
}

#[tokio::test]
async fn edit_receipt_omits_organization_from_access_check() {
    let entity_access_service = FakeEntityAccessService::default();
    let response = test_router(entity_access_service.clone())
        .oneshot(bearer_request("/edit/DOCUMENT/document-id", "valid"))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        entity_access_service.calls(),
        [AccessCall::GenerateReceipt {
            user_id: VALID_USER_ID.to_string(),
            organization_id: None,
            entity_id: "document-id".to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn receipt_rejection_preserves_expired_token_message() {
    let response = test_router(FakeEntityAccessService::default())
        .oneshot(bearer_request("/edit/DOCUMENT/document-id", "expired"))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response_body(response).await, "jwt expired");
}

#[tokio::test]
async fn malformed_typed_path_is_rejected_before_missing_authentication() {
    let response = test_router(FakeEntityAccessService::default())
        .oneshot(request("/edit/not-an-entity/document-id"))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body(response).await,
        "Missing or invalid entity_type / entity_id in path"
    );
}
