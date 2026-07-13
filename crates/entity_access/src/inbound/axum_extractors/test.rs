use std::sync::Arc;

use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::get,
};
use macro_authorization::{
    MacroAuthorizationError, SharedMacroAuthorizationService,
    testing::{FakeMacroAuthorizationService, bearer},
};
use macro_user_id::{
    cowlike::CowLike,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model::document::DocumentBasic;
use tower::ServiceExt;
use uuid::Uuid;

use super::DocumentAccessExtractor;
use crate::domain::{
    models::{
        AccessError, AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission,
        EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
    },
    ports::EntityAccessService,
};

#[derive(Clone, Copy)]
struct PublicEntityAccessService;

impl EntityAccessService for PublicEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        assert!(user_id.is_none());
        assert_eq!(entity_id, "public-document");
        assert_eq!(entity_type, EntityType::Document);
        Ok(Some(AccessLevel::View))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Ok(AccessLevel::View)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::Internal)
    }
}

#[derive(Clone)]
struct TestState {
    access: Arc<PublicEntityAccessService>,
    authorization: SharedMacroAuthorizationService,
}

impl FromRef<TestState> for Arc<PublicEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.access.clone()
    }
}

impl FromRef<TestState> for SharedMacroAuthorizationService {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

async fn document_access_handler(
    _access: DocumentAccessExtractor<ViewAccessLevel, PublicEntityAccessService>,
) -> StatusCode {
    StatusCode::NO_CONTENT
}

fn public_document() -> DocumentBasic {
    DocumentBasic {
        document_id: "public-document".to_string(),
        document_name: "Public document".to_string(),
        owner: MacroUserIdStr::parse_from_str("macro|owner@example.com")
            .unwrap()
            .into_owned(),
        file_type: None,
        sub_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

fn test_router(authorization: FakeMacroAuthorizationService) -> Router {
    Router::new()
        .route("/document", get(document_access_handler))
        .layer(Extension(public_document()))
        .with_state(TestState {
            access: Arc::new(PublicEntityAccessService),
            authorization: SharedMacroAuthorizationService::new(authorization),
        })
}

#[tokio::test]
async fn no_credentials_use_anonymous_public_access() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials);
    let response = test_router(authorization.clone())
        .oneshot(Request::get("/document").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(authorization.calls().is_empty());
}

#[tokio::test]
async fn expired_credentials_preserve_authorization_rejection() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let request = bearer(Request::get("/document"), "expired")
        .body(Body::empty())
        .unwrap();
    let response = test_router(authorization.clone())
        .oneshot(request)
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert_eq!(authorization.calls(), ["expired"]);
}
