use crate::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::get,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::EntityPermissionExtractor;
use crate::{
    domain::{
        models::{
            AccessError, AccessLevel, BotId, CallChannelInfo, EntityAccessAuth,
            EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, UserTeamInfo,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::test_support::{VALID_BOT_TOKEN, valid_bot_authentication},
};

const USER_ID: &str = "macro|user@example.com";
const INTERNAL_USER_ID: &str = "macro|internal@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";
const ENTITY_ID: &str = "entity-id";

#[derive(Clone, Debug, Eq, PartialEq)]
enum EntityAccessCall {
    GetEntityPermission {
        user_id: Option<String>,
        entity_id: String,
        entity_type: EntityType,
        organization_id: Option<i64>,
    },
    CheckPublicAccess {
        entity_id: String,
        entity_type: EntityType,
        required_level: AccessLevel,
    },
}

#[derive(Clone, Default)]
struct FakeEntityAccessService {
    calls: Arc<Mutex<Vec<EntityAccessCall>>>,
}

impl FakeEntityAccessService {
    fn calls(&self) -> Vec<EntityAccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_entity_access_receipt call")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_bot_entity_access_receipt call")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected get_access_level call")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(EntityAccessCall::CheckPublicAccess {
                entity_id: entity_id.to_string(),
                entity_type,
                required_level,
            });

        Ok(AccessLevel::View)
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        organization_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        self.calls.lock().expect("calls lock poisoned").push(
            EntityAccessCall::GetEntityPermission {
                user_id: user_id.map(|user_id| user_id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
                organization_id,
            },
        );

        Ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected get_user_team call")
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum AuthorizationCall {
    Bearer(String),
    Bot(String),
    Internal {
        provided_key: String,
        claims: InternalIdentityClaims,
    },
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<Mutex<Vec<AuthorizationCall>>>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> Vec<AuthorizationCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Bearer(jwt.to_string()));

        match jwt {
            "valid" => Ok(user_context(USER_ID, None)),
            "organization" => Ok(user_context(USER_ID, Some(42))),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Bot(token.to_string()));

        if token != VALID_BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(valid_bot_authentication(bot_scope))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AuthorizationCall::Internal {
                provided_key: provided_key.to_string(),
                claims: claims.clone(),
            });

        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims
            .user_id
            .as_deref()
            .map(|user_id| user_context(user_id, claims.organization_id)))
    }
}

fn user_context(user_id: &str, organization_id: Option<i32>) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id,
        permissions: None,
    }
}

#[derive(Clone)]
struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl FromRef<TestState> for Arc<FakeEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.entity_access.clone()
    }
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn handler(
    extractor: EntityPermissionExtractor<FakeEntityAccessService, FakeAuthorizationService>,
) -> Json<Value> {
    let receipt = extractor.entity_access_receipt;
    let auth = match receipt.auth {
        EntityAccessAuth::Authenticated(user_id) => json!({ "authenticated": user_id.to_string() }),
        EntityAccessAuth::Bot(bot_id) => json!({ "bot": bot_id.to_string() }),
        EntityAccessAuth::Unauthenticated => json!("unauthenticated"),
        EntityAccessAuth::Internal => json!("internal"),
    };

    Json(json!({
        "auth": auth,
        "entity_id": receipt.entity.entity_id,
        "entity_type": receipt.entity.entity_type.to_string(),
        "permission": receipt.entity_permission,
    }))
}

fn test_router() -> (Router, FakeEntityAccessService, FakeAuthorizationService) {
    let entity_access = FakeEntityAccessService::default();
    let authorization = FakeAuthorizationService::default();
    let state = TestState {
        entity_access: Arc::new(entity_access.clone()),
        authorization: MacroAuthorizationState::new(Arc::new(authorization.clone())),
    };
    let router = Router::new()
        .route("/entity/{entity_type}/{entity_id}", get(handler))
        .with_state(state);

    (router, entity_access, authorization)
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");

    (status, body)
}

fn request(path: &str) -> axum::http::request::Builder {
    Request::get(path)
}

fn empty_body(request: axum::http::request::Builder) -> Request<Body> {
    request.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn bearer_authentication_looks_up_the_users_permission() {
    let (router, entity_access, authorization) = test_router();
    let request = empty_body(
        request(&format!("/entity/document/{ENTITY_ID}"))
            .header(header::AUTHORIZATION, "Bearer valid"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"], json!({ "authenticated": USER_ID }));
    assert_eq!(body["permission"]["access_level"], "edit");
    assert_eq!(
        entity_access.calls(),
        [EntityAccessCall::GetEntityPermission {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
            organization_id: None,
        }]
    );
    assert_eq!(
        authorization.calls(),
        [AuthorizationCall::Bearer("valid".to_string())]
    );
}

#[tokio::test]
async fn organization_id_is_forwarded_to_the_permission_lookup() {
    let (router, entity_access, _authorization) = test_router();
    let request = empty_body(
        request(&format!("/entity/document/{ENTITY_ID}"))
            .header(header::AUTHORIZATION, "Bearer organization"),
    );

    let (status, _body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        entity_access.calls(),
        [EntityAccessCall::GetEntityPermission {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
            organization_id: Some(42),
        }]
    );
}

#[tokio::test]
async fn anonymous_requests_check_public_view_access() {
    let (router, entity_access, authorization) = test_router();

    let (status, body) = send(
        &router,
        empty_body(request(&format!("/entity/project/{ENTITY_ID}"))),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"], "unauthenticated");
    assert_eq!(body["permission"]["access_level"], "view");
    assert_eq!(
        entity_access.calls(),
        [EntityAccessCall::CheckPublicAccess {
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Project,
            required_level: AccessLevel::View,
        }]
    );
    assert!(authorization.calls().is_empty());
}

#[tokio::test]
async fn invalid_and_expired_tokens_preserve_authorization_rejections() {
    for (token, expected_message) in [("invalid", "unauthorized"), ("expired", "jwt expired")] {
        let (router, entity_access, _authorization) = test_router();
        let request = empty_body(
            request(&format!("/entity/document/{ENTITY_ID}"))
                .header(header::AUTHORIZATION, format!("Bearer {token}")),
        );

        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": expected_message }));
        assert!(entity_access.calls().is_empty());
    }
}

#[tokio::test]
async fn bot_credentials_are_forbidden_without_permission_lookup() {
    let (router, entity_access, authorization) = test_router();
    let request = empty_body(
        request(&format!("/entity/document/{ENTITY_ID}"))
            .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
            .header(BOT_SCOPE_HEADER, BotScope::User.as_str()),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, json!({ "message": "forbidden" }));
    assert!(entity_access.calls().is_empty());
    assert_eq!(
        authorization.calls(),
        [AuthorizationCall::Bot(VALID_BOT_TOKEN.to_string())]
    );
}

#[tokio::test]
async fn internal_request_with_acting_user_looks_up_the_users_permission() {
    let (router, entity_access, authorization) = test_router();
    let request = empty_body(
        request(&format!("/entity/document/{ENTITY_ID}"))
            .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
            .header(INTERNAL_MACRO_USER_ID_HEADER, INTERNAL_USER_ID)
            .header(INTERNAL_MACRO_ORGANIZATION_ID_HEADER, "84"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"], json!({ "authenticated": INTERNAL_USER_ID }));
    assert_eq!(
        entity_access.calls(),
        [EntityAccessCall::GetEntityPermission {
            user_id: Some(INTERNAL_USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::Document,
            organization_id: Some(84),
        }]
    );
    assert_eq!(
        authorization.calls(),
        [AuthorizationCall::Internal {
            provided_key: INTERNAL_KEY.to_string(),
            claims: InternalIdentityClaims {
                user_id: Some(INTERNAL_USER_ID.to_string()),
                fusion_user_id: None,
                organization_id: Some(84),
            },
        }]
    );
}

#[tokio::test]
async fn identity_less_internal_requests_receive_typed_internal_permissions() {
    let (router, entity_access, authorization) = test_router();

    for (entity_type, expected_level) in [
        ("document", AccessLevel::Owner),
        ("foreign_entity", AccessLevel::View),
    ] {
        let request = empty_body(
            request(&format!("/entity/{entity_type}/{ENTITY_ID}"))
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY),
        );
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["auth"], "internal");
        assert_eq!(
            body["permission"]["access_level"],
            serde_json::to_value(expected_level).unwrap()
        );
    }

    assert!(entity_access.calls().is_empty());
    assert_eq!(
        authorization.calls(),
        [
            AuthorizationCall::Internal {
                provided_key: INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
            AuthorizationCall::Internal {
                provided_key: INTERNAL_KEY.to_string(),
                claims: InternalIdentityClaims::default(),
            },
        ]
    );
}

#[tokio::test]
async fn invalid_entity_types_return_bad_request_without_access_lookup() {
    let (router, entity_access, _authorization) = test_router();

    let (status, body) = send(
        &router,
        empty_body(request(&format!("/entity/not-an-entity/{ENTITY_ID}"))),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "message": "Bad request: Invalid entity type" })
    );
    assert!(entity_access.calls().is_empty());
}

#[tokio::test]
async fn thread_path_alias_maps_to_email_thread() {
    let (router, entity_access, _authorization) = test_router();
    let request = empty_body(
        request(&format!("/entity/thread/{ENTITY_ID}"))
            .header(header::AUTHORIZATION, "Bearer valid"),
    );

    let (status, body) = send(&router, request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["entity_type"], "email_thread");
    assert_eq!(
        entity_access.calls(),
        [EntityAccessCall::GetEntityPermission {
            user_id: Some(USER_ID.to_string()),
            entity_id: ENTITY_ID.to_string(),
            entity_type: EntityType::EmailThread,
            organization_id: None,
        }]
    );
}
