use entity_access::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, UserTeamInfo, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use http_body_util::BodyExt;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
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

use super::{ForeignEntityRouterState, foreign_entity_router};
use crate::domain::{
    models::{
        CreateForeignEntity, ForeignEntity, ForeignEntityError, PatchForeignEntity, SourceId,
    },
    ports::{ForeignEntityListQuery, ForeignEntityService},
};

/// A recorded by-source lookup: the external identifier and source filter.
type BySourceLookup = (String, Option<String>);

#[derive(Clone)]
struct StubForeignEntityService {
    response: StubForeignEntityResponse,
    receipt_entity_ids: Arc<Mutex<Vec<String>>>,
    by_source_records: Vec<ForeignEntity>,
    by_source_lookups: Arc<Mutex<Vec<BySourceLookup>>>,
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
            by_source_records: Vec::new(),
            by_source_lookups: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Stub that only answers by-source lookups, with the supplied records.
    fn by_source(records: Vec<ForeignEntity>) -> Self {
        Self {
            by_source_records: records,
            ..Self::new(StubForeignEntityResponse::NotFound(Uuid::nil()))
        }
    }

    fn by_source_lookups(&self) -> Vec<BySourceLookup> {
        self.by_source_lookups
            .lock()
            .expect("stub foreign entity service lookup lock poisoned")
            .clone()
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
        foreign_entity_id: &str,
        foreign_entity_source: Option<&str>,
    ) -> Result<Vec<ForeignEntity>, ForeignEntityError> {
        self.by_source_lookups
            .lock()
            .expect("stub foreign entity service lookup lock poisoned")
            .push((
                foreign_entity_id.to_string(),
                foreign_entity_source.map(str::to_string),
            ));

        Ok(self
            .by_source_records
            .iter()
            .filter(|record| {
                record.foreign_entity_id == foreign_entity_id
                    && foreign_entity_source
                        .is_none_or(|source| record.foreign_entity_source == source)
            })
            .cloned()
            .collect())
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

/// Entity access stub that grants view access to an explicit allow list and
/// answers `Unauthorized` — the way the real service reports "no access" — for
/// everything else.
#[derive(Clone, Default)]
struct StubEntityAccessService {
    viewable_entity_ids: Vec<String>,
}

impl StubEntityAccessService {
    fn viewing(entity_ids: Vec<String>) -> Self {
        Self {
            viewable_entity_ids: entity_ids,
        }
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
        unreachable!("identity-less internal access should bypass real access receipt generation")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!("identity-less internal access should bypass bot access receipt generation")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!("identity-less internal access should bypass real access checks")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("identity-less internal access should bypass real access checks")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!("identity-less internal access should bypass real access checks")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        assert_eq!(entity_type, EntityType::ForeignEntity);

        if self
            .viewable_entity_ids
            .iter()
            .any(|viewable| viewable == entity_id)
        {
            return Ok(EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            });
        }

        Err(AccessError::Unauthorized)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
        unreachable!("identity-less internal access should bypass real access checks")
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

const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone, Debug, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, _jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        unreachable!("internal requests should not authorize user credentials")
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            fusion_user_id: "fusion-user-id".to_string(),
            organization_id: None,
            permissions: None,
        }))
    }
}

fn test_router(service: Arc<StubForeignEntityService>) -> Router {
    router_with_access(service, StubEntityAccessService::default())
}

fn router_with_access(
    service: Arc<StubForeignEntityService>,
    access_service: StubEntityAccessService,
) -> Router {
    foreign_entity_router(ForeignEntityRouterState::new(
        service,
        Arc::new(access_service),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

fn internal_get_as_user(uri: impl Into<String>, user_id: &str) -> Request<Body> {
    Request::builder()
        .method(Method::GET)
        .uri(uri.into())
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, user_id)
        .body(Body::empty())
        .expect("test request should be built")
}

fn anonymous_get(uri: impl Into<String>) -> Request<Body> {
    Request::builder()
        .method(Method::GET)
        .uri(uri.into())
        .body(Body::empty())
        .expect("test request should be built")
}

fn internal_get(uri: impl Into<String>) -> Request<Body> {
    Request::builder()
        .method(Method::GET)
        .uri(uri.into())
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
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
    let response = test_router(service.clone())
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
async fn get_foreign_entity_rejects_invalid_uuid() {
    let service = Arc::new(StubForeignEntityService::entity(foreign_entity(
        Uuid::new_v4(),
    )));
    let response = test_router(service.clone())
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
    let response = test_router(service.clone())
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

const PULL_REQUEST_SOURCE: &str = "github_pull_request";
const PULL_REQUEST_KEY: &str = "macro/app/pull/42";
const TEST_USER_ID: &str = "macro|user@macro.com";

fn pull_request_entity() -> ForeignEntity {
    ForeignEntity {
        foreign_entity_id: PULL_REQUEST_KEY.to_string(),
        foreign_entity_source: PULL_REQUEST_SOURCE.to_string(),
        ..foreign_entity(Uuid::new_v4())
    }
}

fn by_source_uri() -> String {
    format!("/by_source/{PULL_REQUEST_SOURCE}/{PULL_REQUEST_KEY}")
}

#[tokio::test]
async fn get_foreign_entity_by_source_returns_entity_for_internal_caller() {
    let entity = pull_request_entity();
    let service = Arc::new(StubForeignEntityService::by_source(vec![entity.clone()]));
    let response = test_router(service.clone())
        .oneshot(internal_get(by_source_uri()))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        expected_foreign_entity_json(&entity)
    );
    assert_eq!(
        service.by_source_lookups(),
        vec![(
            PULL_REQUEST_KEY.to_string(),
            Some(PULL_REQUEST_SOURCE.to_string()),
        )]
    );
}

#[tokio::test]
async fn get_foreign_entity_by_source_returns_entity_the_user_may_view() {
    let entity = pull_request_entity();
    let service = Arc::new(StubForeignEntityService::by_source(vec![entity.clone()]));
    let response = router_with_access(
        service.clone(),
        StubEntityAccessService::viewing(vec![entity.id.to_string()]),
    )
    .oneshot(internal_get_as_user(by_source_uri(), TEST_USER_ID))
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        expected_foreign_entity_json(&entity)
    );
}

#[tokio::test]
async fn get_foreign_entity_by_source_hides_entities_the_user_may_not_view() {
    let entity = pull_request_entity();
    let service = Arc::new(StubForeignEntityService::by_source(vec![entity]));
    let response = router_with_access(service.clone(), StubEntityAccessService::default())
        .oneshot(internal_get_as_user(by_source_uri(), TEST_USER_ID))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(response).await["message"],
        format!("foreign entity not found: {PULL_REQUEST_SOURCE}/{PULL_REQUEST_KEY}")
    );
}

#[tokio::test]
async fn get_foreign_entity_by_source_maps_no_match_to_404() {
    let service = Arc::new(StubForeignEntityService::by_source(Vec::new()));
    let response = test_router(service.clone())
        .oneshot(internal_get(by_source_uri()))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_foreign_entity_by_source_rejects_anonymous_callers() {
    let service = Arc::new(StubForeignEntityService::by_source(vec![
        pull_request_entity(),
    ]));
    let response = test_router(service.clone())
        .oneshot(anonymous_get(by_source_uri()))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.by_source_lookups().is_empty());
}
