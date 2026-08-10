//! HTTP-level tests: status mapping, entity-pair validation, receipt minting,
//! JSON shape, and the pagination round-trip through query params.

use std::sync::{Arc, Mutex};

use axum::http::header;
use chrono::{DateTime, TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, AnyEntityPermission, BotAccessScope, BotId, CallChannelInfo,
    Entity as AccessEntity, EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::models::{ReminderCursor, ReminderForSoup, ReminderPage, SoupReminderQuery};

const USER_ID: &str = "macro|reminders-user@macro.com";
const VALID_JWT: &str = "valid";
/// The one entity the fake access service grants view access to.
// Entity ids are uuids: `reminder.entity_id` is a uuid column, and the router
// rejects anything that does not parse.
const ACCESSIBLE_DOC: &str = "11111111-1111-4111-8111-111111111111";
const FORBIDDEN_DOC: &str = "22222222-2222-4222-8222-222222222222";

fn instant(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 7, day, hour, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn user_context() -> UserContext {
    UserContext {
        user_id: USER_ID.to_string(),
        fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        permissions: None,
        organization_id: None,
    }
}

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != VALID_JWT {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(user_context())
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Grants view access to [`ACCESSIBLE_DOC`] only. Every other capability errors,
/// since the reminders router never uses them.
#[derive(Clone, Default)]
struct FakeEntityAccessService {
    receipts_minted: Arc<Mutex<Vec<(String, EntityType)>>>,
    /// Error returned for anything other than [`ACCESSIBLE_DOC`]. `None` means
    /// [`AccessError::Unauthorized`], which is the common case.
    denial: Option<fn() -> AccessError>,
    /// When set, the caller owns no reminders, so `ReminderAccessExtractor`
    /// rejects every item route.
    reminder_not_owned: bool,
}

impl FakeEntityAccessService {
    /// The caller owns no reminders.
    fn without_reminder_ownership() -> Self {
        Self {
            reminder_not_owned: true,
            ..Self::default()
        }
    }
}

impl FakeEntityAccessService {
    /// Denies with a specific [`AccessError`], so the router's mapping of each
    /// variant can be exercised.
    fn denying_with(denial: fn() -> AccessError) -> Self {
        Self {
            denial: Some(denial),
            ..Self::default()
        }
    }

    fn minted(&self) -> Vec<(String, EntityType)> {
        self.receipts_minted
            .lock()
            .expect("mint log poisoned")
            .clone()
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.receipts_minted
            .lock()
            .expect("mint log poisoned")
            .push((entity_id.to_string(), entity_type));

        if entity_id != ACCESSIBLE_DOC {
            return Err(self.denial.map_or(AccessError::Unauthorized, |make| make()));
        }

        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::parse_from_str(USER_ID)
                .expect("valid user id")
                .clone(),
            AccessEntity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        )
        .inspect(|_| debug_assert_eq!(user_id.as_ref(), USER_ID))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        // `ReminderAccessExtractor` resolves ownership through this. A reminder
        // grants Owner or nothing; the router never asks about anything else.
        if entity_type == EntityType::Reminder {
            return Ok((!self.reminder_not_owned).then_some(AccessLevel::Owner));
        }
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
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
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
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
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

fn sample_reminder(entity_id: Option<&str>) -> Reminder {
    Reminder {
        id: Uuid::from_u128(1),
        description: "follow up".to_string(),
        entity_type: entity_id.map(|_| EntityType::Document),
        entity_id: entity_id.map(str::to_string),
        schedule: ReminderSchedule::Once {
            remind_at: instant(2, 13),
        },
        next_run_at: instant(2, 13),
        enabled: true,
        completed_at: None,
        created_at: instant(1, 12),
        updated_at: instant(1, 12),
    }
}

/// What the fake service was asked to do, so the router's translation of
/// transport input into domain calls can be asserted.
#[derive(Debug, Clone, PartialEq)]
enum ServiceCall {
    Create {
        description: String,
        entity: Option<(EntityType, String)>,
        has_receipt: bool,
    },
    List {
        entity: Option<(EntityType, String)>,
        include_completed: bool,
        limit: Option<u32>,
        cursor: Option<ReminderCursor>,
    },
    Get(Uuid),
    Update {
        id: Uuid,
        description: Option<String>,
        enabled: Option<bool>,
        has_schedule: bool,
    },
    Delete(Uuid),
}

#[derive(Clone, Default)]
struct FakeRemindersService {
    calls: Arc<Mutex<Vec<ServiceCall>>>,
    /// When set, every method returns this error instead of succeeding.
    error: Option<Arc<dyn Fn() -> ReminderError + Send + Sync>>,
    next_cursor: Option<ReminderCursor>,
}

impl FakeRemindersService {
    fn failing(error: impl Fn() -> ReminderError + Send + Sync + 'static) -> Self {
        Self {
            error: Some(Arc::new(error)),
            ..Default::default()
        }
    }

    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().expect("call log poisoned").clone()
    }

    fn record(&self, call: ServiceCall) {
        self.calls.lock().expect("call log poisoned").push(call);
    }

    fn fail_if_configured(&self) -> Result<(), ReminderError> {
        match &self.error {
            Some(error) => Err(error()),
            None => Ok(()),
        }
    }
}

/// The reminder a receipt was minted for.
fn receipt_id(receipt: &EntityAccessReceipt<OwnerAccessLevel>) -> Uuid {
    receipt
        .entity()
        .entity_id
        .parse()
        .expect("the extractor only mints receipts for a parsed uuid")
}

/// The entity named by a list filter, which is a read filter and so still
/// carries the entity directly.
fn entity_pair(entity: &Option<Entity<'static>>) -> Option<(EntityType, String)> {
    entity
        .as_ref()
        .map(|entity| (entity.entity_type, entity.entity_id.to_string()))
}

/// The entity a create request attaches to, which the receipt carries now that
/// `create_reminder` takes a receipt rather than an entity.
fn receipt_entity_pair(
    receipt: &Option<EntityAccessReceipt<AnyEntityPermission>>,
) -> Option<(EntityType, String)> {
    receipt.as_ref().map(|receipt| {
        let entity = receipt.entity();
        (entity.entity_type, entity.entity_id.clone())
    })
}

impl RemindersService for FakeRemindersService {
    async fn create_reminder(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        request: CreateReminder,
        entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> Result<Reminder, ReminderError> {
        let entity = receipt_entity_pair(&entity_receipt);
        self.record(ServiceCall::Create {
            description: request.description.clone(),
            entity: entity.clone(),
            has_receipt: entity_receipt.is_some(),
        });
        self.fail_if_configured()?;
        Ok(sample_reminder(entity.as_ref().map(|(_, id)| id.as_str())))
    }

    async fn get_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Reminder, ReminderError> {
        self.record(ServiceCall::Get(receipt_id(&receipt)));
        self.fail_if_configured()?;
        Ok(sample_reminder(None))
    }

    async fn list_reminders(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        filter: ReminderFilter,
    ) -> Result<ReminderPage, ReminderError> {
        self.record(ServiceCall::List {
            entity: entity_pair(&filter.entity),
            include_completed: filter.include_completed,
            limit: filter.limit,
            cursor: filter.cursor,
        });
        self.fail_if_configured()?;
        Ok(ReminderPage {
            reminders: vec![sample_reminder(None)],
            next_cursor: self.next_cursor,
        })
    }

    /// Unused by the router — Soup calls the service directly.
    async fn list_reminders_for_soup(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, ReminderError> {
        self.fail_if_configured()?;
        Ok(vec![ReminderForSoup {
            reminder: sample_reminder(None),
            reference: None,
        }])
    }

    async fn update_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        patch: ReminderPatch,
    ) -> Result<Reminder, ReminderError> {
        self.record(ServiceCall::Update {
            id: receipt_id(&receipt),
            description: patch.description.clone(),
            enabled: patch.enabled,
            has_schedule: patch.schedule.is_some(),
        });
        self.fail_if_configured()?;
        Ok(sample_reminder(None))
    }

    async fn delete_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), ReminderError> {
        self.record(ServiceCall::Delete(receipt_id(&receipt)));
        self.fail_if_configured()?;
        Ok(())
    }
}

fn build_router(service: FakeRemindersService, access: FakeEntityAccessService) -> axum::Router {
    reminders_router(RemindersRouterState::new(
        Arc::new(service),
        Arc::new(access),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

fn authed(builder: axum::http::request::Builder) -> axum::http::request::Builder {
    builder.header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"))
}

fn json_body(value: serde_json::Value) -> axum::body::Body {
    axum::body::Body::from(value.to_string())
}

async fn read_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    if bytes.is_empty() {
        return serde_json::Value::Null;
    }
    serde_json::from_slice(&bytes).expect("body should be json")
}

fn once_schedule() -> serde_json::Value {
    serde_json::json!({"type": "once", "remindAt": "2026-07-02T13:00:00Z"})
}

#[tokio::test]
async fn create_returns_201_with_the_reminder() {
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::post("/"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({
                    "description": "follow up",
                    "schedule": once_schedule(),
                })))
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = read_json(response).await;
    assert_eq!(body["description"], "follow up");
    assert_eq!(body["nextRunAt"], "2026-07-02T13:00:00Z");
    assert_eq!(body["schedule"]["type"], "once");
    // Standalone reminders carry no receipt inward.
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Create {
            description: "follow up".to_string(),
            entity: None,
            has_receipt: false,
        }]
    );
}

#[tokio::test]
async fn create_with_an_accessible_entity_mints_a_receipt() {
    let service = FakeRemindersService::default();
    let access = FakeEntityAccessService::default();
    let response = build_router(service.clone(), access.clone())
        .oneshot(
            authed(axum::http::Request::post("/"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({
                    "description": "review this",
                    "entityType": "document",
                    "entityId": ACCESSIBLE_DOC,
                    "schedule": once_schedule(),
                })))
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        access.minted(),
        vec![(ACCESSIBLE_DOC.to_string(), EntityType::Document)],
        "the receipt must be minted for the entity the client named"
    );
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Create {
            description: "review this".to_string(),
            entity: Some((EntityType::Document, ACCESSIBLE_DOC.to_string())),
            has_receipt: true,
        }]
    );
}

#[tokio::test]
async fn create_with_an_inaccessible_entity_is_403_and_never_reaches_the_service() {
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::post("/"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({
                    "description": "peek",
                    "entityType": "document",
                    "entityId": FORBIDDEN_DOC,
                    "schedule": once_schedule(),
                })))
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(
        service.calls().is_empty(),
        "a failed access check must not create anything"
    );
}

#[tokio::test]
async fn a_half_supplied_entity_pair_is_400() {
    for body in [
        serde_json::json!({
            "description": "x", "entityType": "document", "schedule": once_schedule(),
        }),
        serde_json::json!({
            "description": "x", "entityId": ACCESSIBLE_DOC, "schedule": once_schedule(),
        }),
        serde_json::json!({
            "description": "x", "entityType": "document", "entityId": "   ",
            "schedule": once_schedule(),
        }),
    ] {
        let service = FakeRemindersService::default();
        let response = build_router(service.clone(), FakeEntityAccessService::default())
            .oneshot(
                authed(axum::http::Request::post("/"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(json_body(body.clone()))
                    .expect("request should build"),
            )
            .await
            .expect("router should respond");

        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "expected 400 for {body}"
        );
        assert!(service.calls().is_empty(), "should not reach the service");
    }
}

#[tokio::test]
async fn an_unparseable_cron_is_400_at_the_body() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "description": "x",
                "schedule": {"type": "recurring", "cron": "nope", "timezone": "America/New_York"},
            })))
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn a_five_field_cron_is_accepted() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "description": "standup",
                "schedule": {
                    "type": "recurring", "cron": "0 9 * * *", "timezone": "America/New_York",
                },
            })))
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn missing_credentials_are_401() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        axum::http::Request::get("/")
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invalid_credentials_are_401() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        axum::http::Request::get("/")
            .header(header::AUTHORIZATION, "Bearer nope")
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_returns_the_wrapped_collection() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::get("/"))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    let body = read_json(response).await;
    assert_eq!(body["reminders"].as_array().expect("array").len(), 1);
    assert!(
        body.get("nextCursor").is_none(),
        "a last page omits nextCursor entirely"
    );
}

#[tokio::test]
async fn list_passes_filters_and_paging_through() {
    let service = FakeRemindersService::default();
    let cursor = ReminderCursor {
        next_run_at: instant(2, 13),
        created_at: instant(1, 12),
        id: Uuid::from_u128(9),
    };
    let uri = format!(
        "/?entityType=document&entityId={ACCESSIBLE_DOC}&includeCompleted=true&limit=25&cursor={}",
        cursor.encode()
    );

    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get(&uri))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.calls(),
        vec![ServiceCall::List {
            entity: Some((EntityType::Document, ACCESSIBLE_DOC.to_string())),
            include_completed: true,
            limit: Some(25),
            cursor: Some(cursor),
        }],
        "the cursor must survive the query string intact"
    );
}

#[tokio::test]
async fn list_surfaces_the_next_cursor() {
    let cursor = ReminderCursor {
        next_run_at: instant(2, 13),
        created_at: instant(1, 12),
        id: Uuid::from_u128(4),
    };
    let service = FakeRemindersService {
        next_cursor: Some(cursor),
        ..Default::default()
    };

    let response = build_router(service, FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get("/"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    let body = read_json(response).await;
    assert_eq!(body["nextCursor"], cursor.encode());
}

#[tokio::test]
async fn a_malformed_cursor_is_400() {
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get("/?cursor=garbage"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn a_list_filter_with_only_an_entity_type_is_400() {
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get("/?entityType=document"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn get_returns_the_reminder() {
    let service = FakeRemindersService::default();
    let id = Uuid::from_u128(42);
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get(format!("/{id}")))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.calls(), vec![ServiceCall::Get(id)]);
}

#[tokio::test]
async fn a_non_uuid_id_is_400() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::get("/not-a-uuid"))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// The item routes are gated by `ReminderAccessExtractor`, so a reminder the
/// caller does not own is refused before the service is reached. "Not yours"
/// and "does not exist" answer the same way on purpose: distinguishing them
/// would say whether the id is real.
#[tokio::test]
async fn a_reminder_the_caller_does_not_own_never_reaches_the_service() {
    let id = Uuid::from_u128(99);
    for request in [
        authed(axum::http::Request::get(format!("/{id}")))
            .body(axum::body::Body::empty())
            .expect("request should build"),
        authed(axum::http::Request::delete(format!("/{id}")))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    ] {
        let service = FakeRemindersService::default();
        let response = build_router(
            service.clone(),
            FakeEntityAccessService::without_reminder_ownership(),
        )
        .oneshot(request)
        .await
        .expect("router should respond");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(
            service.calls().is_empty(),
            "the service must not be reached without an ownership receipt"
        );
    }
}

#[tokio::test]
async fn patch_forwards_only_the_supplied_fields() {
    let service = FakeRemindersService::default();
    let id = Uuid::from_u128(7);
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::patch(format!("/{id}")))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({"enabled": false})))
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Update {
            id,
            description: None,
            enabled: Some(false),
            has_schedule: false,
        }]
    );
}

#[tokio::test]
async fn delete_returns_204_with_no_body() {
    let service = FakeRemindersService::default();
    let id = Uuid::from_u128(3);
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::delete(format!("/{id}")))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(service.calls(), vec![ServiceCall::Delete(id)]);
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    assert!(bytes.is_empty(), "204 must carry no body");
}

#[tokio::test]
async fn domain_errors_map_to_their_status_codes() {
    let table: Vec<(fn() -> ReminderError, StatusCode, bool)> = vec![
        (|| ReminderError::NotFound, StatusCode::NOT_FOUND, true),
        (
            || ReminderError::EntityNotFound,
            StatusCode::NOT_FOUND,
            true,
        ),
        (
            || ReminderError::BadRequest("nope".to_string()),
            StatusCode::BAD_REQUEST,
            true,
        ),
        (
            || ReminderError::EntityAccessDenied,
            StatusCode::FORBIDDEN,
            true,
        ),
        (
            || ReminderError::Internal(rootcause::report!("boom").into_dynamic()),
            StatusCode::INTERNAL_SERVER_ERROR,
            false,
        ),
    ];

    for (make_error, expected_status, message_is_public) in table {
        let expected_message = make_error().to_string();
        let response = build_router(
            FakeRemindersService::failing(make_error),
            FakeEntityAccessService::default(),
        )
        .oneshot(
            authed(axum::http::Request::get(format!("/{}", Uuid::from_u128(1))))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

        assert_eq!(response.status(), expected_status);
        let body = read_json(response).await;
        if message_is_public {
            assert_eq!(body["message"], expected_message);
        } else {
            // Internal errors must not leak their cause.
            assert_eq!(body["message"], "internal server error");
            assert!(!body["message"].to_string().contains("boom"));
        }
    }
}

#[tokio::test]
async fn responses_use_camel_case_field_names() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::get(format!("/{}", Uuid::from_u128(1))))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    let body = read_json(response).await;
    let object = body.as_object().expect("reminder object");
    for field in ["nextRunAt", "createdAt", "updatedAt"] {
        assert!(object.contains_key(field), "missing {field}");
    }
    for field in ["next_run_at", "created_at", "updated_at"] {
        assert!(!object.contains_key(field), "unexpected snake_case {field}");
    }
    // Absent optional fields are omitted rather than sent as null.
    assert!(!object.contains_key("completedAt"));
}

#[tokio::test]
async fn create_does_not_claim_a_location() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "description": "follow up",
                "schedule": once_schedule(),
            })))
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    // Deliberate: the router is mounted under a prefix it cannot see, so an
    // absolute Location would be wrong for the caller. The id is in the body.
    assert!(
        response.headers().get(header::LOCATION).is_none(),
        "Location would be misleading behind the /dss prefix"
    );
    assert_eq!(
        read_json(response).await["id"],
        Uuid::from_u128(1).to_string()
    );
}

#[tokio::test]
async fn an_oversized_limit_clamps_instead_of_failing_to_parse() {
    // With a narrower parameter type this failed at the query extractor with a
    // 400 before the domain's clamp could run.
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get("/?limit=999999"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.calls(),
        vec![ServiceCall::List {
            entity: None,
            include_completed: false,
            limit: Some(999_999),
            cursor: None,
        }],
        "the raw value reaches the domain, which clamps it"
    );
}

#[tokio::test]
async fn a_negative_limit_is_rejected_by_the_query_extractor() {
    let service = FakeRemindersService::default();
    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get("/?limit=-1"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn a_cursor_survives_the_query_string_unencoded() {
    // The delimiter and payload are all RFC 3986 unreserved characters, so the
    // cursor can be pasted straight back into `?cursor=` with no escaping.
    let service = FakeRemindersService::default();
    let cursor = ReminderCursor {
        next_run_at: instant(2, 13),
        created_at: instant(1, 12),
        id: Uuid::from_u128(9),
    };
    let encoded = cursor.encode();
    assert!(!encoded.contains('%'), "cursor should need no escaping");

    let response = build_router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            authed(axum::http::Request::get(format!("/?cursor={encoded}")))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    match service.calls().first() {
        Some(ServiceCall::List { cursor: got, .. }) => assert_eq!(*got, Some(cursor)),
        other => panic!("expected a list call, got {other:?}"),
    }
}

/// Framework-level rejections do not use the `ErrorResponse` envelope that
/// handler errors do. Pinned here so the OpenAPI annotations stay honest: the
/// documented `ErrorResponse` bodies describe handler errors only, and the 422
/// response is documented without a body schema.
#[tokio::test]
async fn extractor_rejections_are_plain_text_not_error_response() {
    let cases = [
        // Malformed body: rejected by the JSON extractor as 422.
        (
            authed(axum::http::Request::post("/"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({"description": "x"})))
                .expect("request should build"),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ];

    for (request, expected_status) in cases {
        let response = build_router(
            FakeRemindersService::default(),
            FakeEntityAccessService::default(),
        )
        .oneshot(request)
        .await
        .expect("router should respond");

        assert_eq!(response.status(), expected_status);
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(
            content_type.starts_with("text/plain"),
            "expected a plain-text rejection, got {content_type:?}"
        );
    }

    // Handler errors, by contrast, do use the JSON envelope.
    let response = build_router(
        FakeRemindersService::failing(|| ReminderError::NotFound),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::get(format!("/{}", Uuid::from_u128(1))))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await
    .expect("router should respond");
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );
}

#[tokio::test]
async fn an_invalid_cron_message_reaches_the_client() {
    // The 422 body is plain text, but it carries our guidance about accepted
    // cron forms, which is the whole point of the improved error message.
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::default(),
    )
    .oneshot(
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "description": "x",
                "schedule": {"type": "recurring", "cron": "nope", "timezone": "America/New_York"},
            })))
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    let body = String::from_utf8_lossy(&bytes);
    assert!(body.contains("expected 5 fields"), "unhelpful body: {body}");
}

/// The router declares its collection routes at `/` and DSS mounts it with
/// `.nest("/reminders", ..)`, so the paths clients actually call are
/// `/reminders` and `/reminders/{id}` — never the bare `/` every other test in
/// this file exercises. Nesting a `/` route is a known routing footgun (whether
/// the prefix alone matches, or only the prefix with a trailing slash), so pin
/// the mounted shape here rather than inferring it from the nested router.
fn mounted_router(service: FakeRemindersService) -> axum::Router {
    axum::Router::new().nest(
        "/reminders",
        build_router(service, FakeEntityAccessService::default()),
    )
}

#[tokio::test]
async fn list_is_reachable_at_the_mounted_collection_path() {
    let service = FakeRemindersService::default();
    let response = mounted_router(service.clone())
        .oneshot(
            authed(axum::http::Request::get("/reminders"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        service
            .calls()
            .iter()
            .any(|call| matches!(call, ServiceCall::List { .. })),
        "GET /reminders did not reach the handler"
    );
}

/// Axum 0.8 dropped implicit trailing-slash redirects, so the nested `/` route
/// answers `/reminders` and *only* `/reminders`. Documented rather than fixed:
/// every other router DSS nests behaves the same way, the OpenAPI spec and the
/// generated clients all use the unslashed form, and adding a redirect layer
/// for this one router would make it the odd one out.
#[tokio::test]
async fn the_mounted_collection_path_does_not_answer_a_trailing_slash() {
    let response = mounted_router(FakeRemindersService::default())
        .oneshot(
            authed(axum::http::Request::get("/reminders/"))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_is_reachable_at_the_mounted_collection_path() {
    let service = FakeRemindersService::default();
    let response = mounted_router(service.clone())
        .oneshot(
            authed(axum::http::Request::post("/reminders"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(json_body(serde_json::json!({
                    "description": "follow up",
                    "schedule": once_schedule(),
                })))
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert!(
        service
            .calls()
            .iter()
            .any(|call| matches!(call, ServiceCall::Create { .. })),
        "POST /reminders did not reach the handler"
    );
}

#[tokio::test]
async fn item_routes_are_reachable_at_the_mounted_path() {
    let id = Uuid::now_v7();
    let service = FakeRemindersService::default();
    let response = mounted_router(service.clone())
        .oneshot(
            authed(axum::http::Request::get(format!("/reminders/{id}")))
                .body(axum::body::Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        service.calls().contains(&ServiceCall::Get(id)),
        "GET /reminders/{{id}} did not reach the handler"
    );
}

/// A create naming an entity that does not exist must not answer "reminder not
/// found" — there is no reminder yet, and that wording sends a client looking
/// for the wrong thing. `EntityNotFound` keeps the 404 but says which object is
/// missing.
#[tokio::test]
async fn creating_against_a_missing_entity_says_the_entity_is_missing() {
    let response = build_router(
        FakeRemindersService::default(),
        FakeEntityAccessService::denying_with(|| AccessError::NotFound("doc")),
    )
    .oneshot(
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "description": "follow up",
                "entityType": "document",
                "entityId": "33333333-3333-4333-8333-333333333333",
                "schedule": once_schedule(),
            })))
            .expect("request should build"),
    )
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = read_json(response).await;
    let message = body["message"].as_str().unwrap_or_default();
    assert_eq!(message, "entity not found");
    assert!(
        !message.contains("reminder"),
        "create failure should not blame a reminder: {message}"
    );
}
