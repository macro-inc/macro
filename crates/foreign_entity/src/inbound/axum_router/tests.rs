use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use entity_access::{
    domain::{
        models::{
            AccessError, AccessLevel, CallChannelInfo, EntityAccessReceipt, EntityPermission,
            EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::InternalUser,
};
use http_body_util::BodyExt;
use macro_authorization::{
    MacroAuthorizationServiceHandle,
    testing::{FakeMacroAuthorizationService, bearer, test_user_context},
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{ForeignEntityRouterState, foreign_entity_router};
use crate::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};

const TEST_TOKEN: &str = "foreign-entity-token";
const TEST_USER_ID: &str = "macro|foreign-entity@example.com";

#[derive(Clone)]
struct StubForeignEntityService {
    response: StubForeignEntityResponse,
    receipt_entity_ids: Arc<Mutex<Vec<String>>>,
}

#[derive(Clone)]
enum StubForeignEntityResponse {
    Entity(ForeignEntity),
    NotFound(Uuid),
}

impl StubForeignEntityService {
    fn entity(entity: ForeignEntity) -> Self {
        Self::new(StubForeignEntityResponse::Entity(entity))
    }

    fn not_found(id: Uuid) -> Self {
        Self::new(StubForeignEntityResponse::NotFound(id))
    }

    fn new(response: StubForeignEntityResponse) -> Self {
        Self {
            response,
            receipt_entity_ids: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn receipt_entity_ids(&self) -> Vec<String> {
        self.receipt_entity_ids
            .lock()
            .expect("stub foreign entity service receipt lock poisoned")
            .clone()
    }
}

impl ForeignEntityService for StubForeignEntityService {
    async fn get_foreign_entity(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        let entity = receipt.entity();
        if entity.entity_type != EntityType::ForeignEntity {
            return Err(ForeignEntityError::BadRequest(format!(
                "expected ForeignEntity receipt, got {:?}",
                entity.entity_type
            )));
        }

        self.receipt_entity_ids
            .lock()
            .expect("stub foreign entity service receipt lock poisoned")
            .push(entity.entity_id.clone());

        match &self.response {
            StubForeignEntityResponse::Entity(entity) => Ok(entity.clone()),
            StubForeignEntityResponse::NotFound(id) => Err(ForeignEntityError::NotFound(*id)),
        }
    }

    async fn get_foreign_entity_by_id(
        &self,
        _id: Uuid,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("router must call the receipt-based get_foreign_entity method")
    }

    async fn get_foreign_entities_by_foreign_entity_id(
        &self,
        _foreign_entity_id: &str,
        _foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        unreachable!("router does not list foreign entities by external ID")
    }

    async fn get_foreign_entities_for_user(
        &self,
        _requesting_user: Option<String>,
        _source_ids: Vec<SourceId>,
        _limit: u32,
        _query: ForeignEntityListQuery,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        unreachable!("router does not list foreign entities")
    }

    async fn create_foreign_entity(
        &self,
        _create: CreateForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("router does not create foreign entities")
    }

    async fn delete_foreign_entity(&self, _id: Uuid) -> Result<(), ForeignEntityError> {
        unreachable!("router does not delete foreign entities")
    }

    async fn patch_foreign_entity(
        &self,
        _id: Uuid,
        _patch: PatchForeignEntity,
    ) -> Result<ForeignEntity, ForeignEntityError> {
        unreachable!("router does not patch foreign entities")
    }
}

#[derive(Clone, Default)]
struct StubEntityAccessService {
    allow_permission_lookup: bool,
    authorized_user_ids: Arc<Mutex<Vec<String>>>,
}

impl StubEntityAccessService {
    fn authenticated() -> Self {
        Self {
            allow_permission_lookup: true,
            authorized_user_ids: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn authorized_user_ids(&self) -> Vec<String> {
        self.authorized_user_ids
            .lock()
            .expect("authorized user IDs lock poisoned")
            .clone()
    }
}

impl EntityAccessService for StubEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!("InternalUser extension should bypass real access receipt generation")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!("InternalUser extension should bypass real access checks")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("InternalUser extension should bypass real access checks")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("InternalUser extension should bypass real access checks")
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        assert!(
            self.allow_permission_lookup,
            "InternalUser extension should bypass real access checks"
        );
        assert_eq!(entity_type, EntityType::ForeignEntity);

        let user_id = user_id.expect("authenticated access should include a user ID");
        self.authorized_user_ids
            .lock()
            .expect("authorized user IDs lock poisoned")
            .push(user_id.as_ref().to_string());

        Ok(EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, uuid::Uuid), AccessError> {
        unreachable!("InternalUser extension should bypass real access checks")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!("foreign entity router does not list entity users")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!("foreign entity router does not resolve call channels")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!("foreign entity router does not resolve call channels")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unreachable!("foreign entity router does not resolve user teams")
    }
}

fn test_router(
    service: Arc<StubForeignEntityService>,
    access_service: StubEntityAccessService,
    authorization: FakeMacroAuthorizationService,
) -> Router {
    foreign_entity_router(ForeignEntityRouterState::new(
        service,
        Arc::new(access_service),
        MacroAuthorizationServiceHandle::new(authorization),
    ))
}

fn internal_test_router(service: Arc<StubForeignEntityService>) -> Router {
    test_router(
        service,
        StubEntityAccessService::default(),
        FakeMacroAuthorizationService::default(),
    )
}

fn internal_get(uri: impl Into<String>) -> Request<Body> {
    let mut request = Request::builder()
        .method(Method::GET)
        .uri(uri.into())
        .body(Body::empty())
        .expect("test request should be built");

    request.extensions_mut().insert(InternalUser {
        access_level: AccessLevel::Owner,
    });

    request
}

fn authenticated_get(uri: impl Into<String>, token: &str) -> Request<Body> {
    bearer(
        Request::builder().method(Method::GET).uri(uri.into()),
        token,
    )
    .body(Body::empty())
    .expect("test request should be built")
}

async fn response_json(response: Response) -> Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("response body should be collected")
        .to_bytes();

    serde_json::from_slice(bytes.as_ref()).expect("response body should be JSON")
}

fn fixed_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("fixture timestamp should be valid")
        .with_timezone(&Utc)
}

fn foreign_entity(id: Uuid) -> ForeignEntity {
    ForeignEntity {
        id,
        foreign_entity_id: "github:pull-request:123".to_string(),
        foreign_entity_source: "github_pull_request".to_string(),
        metadata: json!({ "repository": "macro/app", "number": 123 }),
        stored_for_id: "document-123".to_string(),
        stored_for_auth_entity: "document".to_string(),
        created_at: fixed_time("2026-05-29T14:00:00Z"),
        updated_at: fixed_time("2026-05-29T15:00:00Z"),
    }
}

fn expected_foreign_entity_json(entity: &ForeignEntity) -> Value {
    json!({
        "id": entity.id.to_string(),
        "foreignEntityId": entity.foreign_entity_id,
        "foreignEntitySource": entity.foreign_entity_source,
        "metadata": entity.metadata,
        "storedForId": entity.stored_for_id,
        "storedForAuthEntity": entity.stored_for_auth_entity,
        "createdAt": serde_json::to_value(&entity.created_at).expect("created_at should serialize"),
        "updatedAt": serde_json::to_value(&entity.updated_at).expect("updated_at should serialize"),
    })
}

#[tokio::test]
async fn get_foreign_entity_returns_camel_case_json_and_forwards_receipt_id() {
    let id = Uuid::new_v4();
    let entity = foreign_entity(id);
    let service = Arc::new(StubForeignEntityService::entity(entity.clone()));
    let response = internal_test_router(service.clone())
        .oneshot(internal_get(format!("/{id}")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        expected_foreign_entity_json(&entity)
    );
    assert_eq!(service.receipt_entity_ids(), vec![id.to_string()]);
}

#[tokio::test]
async fn get_foreign_entity_authenticates_non_internal_requests() {
    let id = Uuid::new_v4();
    let entity = foreign_entity(id);
    let service = Arc::new(StubForeignEntityService::entity(entity.clone()));
    let access_service = StubEntityAccessService::authenticated();
    let authorization = FakeMacroAuthorizationService::always(test_user_context(TEST_USER_ID));
    let authorization_calls = authorization.clone();

    let response = test_router(service.clone(), access_service.clone(), authorization)
        .oneshot(authenticated_get(format!("/{id}"), TEST_TOKEN))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        expected_foreign_entity_json(&entity)
    );
    assert_eq!(authorization_calls.calls(), [TEST_TOKEN]);
    assert_eq!(access_service.authorized_user_ids(), [TEST_USER_ID]);
    assert_eq!(service.receipt_entity_ids(), [id.to_string()]);
}

#[tokio::test]
async fn get_foreign_entity_rejects_invalid_uuid() {
    let service = Arc::new(StubForeignEntityService::entity(foreign_entity(
        Uuid::new_v4(),
    )));
    let response = internal_test_router(service.clone())
        .oneshot(internal_get("/not-a-uuid"))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.receipt_entity_ids().is_empty());
}

#[tokio::test]
async fn get_foreign_entity_maps_not_found_to_404() {
    let id = Uuid::new_v4();
    let service = Arc::new(StubForeignEntityService::not_found(id));
    let response = internal_test_router(service.clone())
        .oneshot(internal_get(format!("/{id}")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(response).await["message"],
        format!("foreign entity not found: {id}")
    );
    assert_eq!(service.receipt_entity_ids(), vec![id.to_string()]);
}
