use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::Response,
    routing::get,
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission,
        EntityType, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    MacroAuthorizationError, SharedMacroAuthorizationService,
    testing::{FakeMacroAuthorizationService, bearer},
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use tower::ServiceExt;
use uuid::Uuid;

use super::{EditReceiptExtractor, ViewReceiptExtractor};
use crate::inbound::axum_router::PropertiesRouterState;

#[derive(Clone, Default)]
struct PublicEntityAccessService {
    public_access_calls: Arc<AtomicUsize>,
}

impl PublicEntityAccessService {
    fn public_access_calls(&self) -> usize {
        self.public_access_calls.load(Ordering::SeqCst)
    }
}

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
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::Internal)
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
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        assert_eq!(entity_id, "public-document");
        assert_eq!(entity_type, EntityType::Document);
        assert_eq!(required_level, AccessLevel::View);
        self.public_access_calls.fetch_add(1, Ordering::SeqCst);
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

async fn view_handler(_receipt: ViewReceiptExtractor) -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn edit_handler(_receipt: EditReceiptExtractor) -> StatusCode {
    StatusCode::NO_CONTENT
}

fn test_router(
    authorization: FakeMacroAuthorizationService,
) -> (Router, PublicEntityAccessService) {
    let entity_access_service = PublicEntityAccessService::default();
    let state = PropertiesRouterState {
        properties_service: Arc::new(()),
        entity_access_service: Arc::new(entity_access_service.clone()),
        authorization_service: SharedMacroAuthorizationService::new(authorization),
    };
    let router = Router::new()
        .route("/view/{entity_type}/{entity_id}", get(view_handler))
        .route("/edit/{entity_type}/{entity_id}", get(edit_handler))
        .with_state(state);

    (router, entity_access_service)
}

#[tokio::test]
async fn anonymous_caller_can_mint_a_public_view_receipt() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::InvalidCredentials);
    let authorization_calls = authorization.clone();
    let (router, entity_access_service) = test_router(authorization);

    let response = router
        .oneshot(
            Request::get("/view/DOCUMENT/public-document")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(authorization_calls.calls().is_empty());
    assert_eq!(entity_access_service.public_access_calls(), 1);
}

#[tokio::test]
async fn expired_credentials_on_public_view_are_not_treated_as_anonymous() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let authorization_calls = authorization.clone();
    let (router, entity_access_service) = test_router(authorization);
    let request = bearer(Request::get("/view/DOCUMENT/public-document"), "expired")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_expired_rejection(response).await;
    assert_eq!(authorization_calls.calls(), ["expired"]);
    assert_eq!(entity_access_service.public_access_calls(), 0);
}

#[tokio::test]
async fn expired_credentials_on_edit_receipt_are_delegated_unchanged() {
    let authorization =
        FakeMacroAuthorizationService::never(MacroAuthorizationError::CredentialsExpired);
    let authorization_calls = authorization.clone();
    let (router, _) = test_router(authorization);
    let request = bearer(Request::get("/edit/DOCUMENT/public-document"), "expired")
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_expired_rejection(response).await;
    assert_eq!(authorization_calls.calls(), ["expired"]);
}

async fn assert_expired_rejection(response: Response) {
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response.headers().get(header::WWW_AUTHENTICATE).unwrap(),
        "Bearer error=\"invalid_token\", error_description=\"jwt expired\""
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
}
