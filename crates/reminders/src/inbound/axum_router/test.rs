//! HTTP-level tests for email collection access and removed generic endpoints.

use std::sync::{Arc, Mutex};

use axum::http::header;
use chrono::{DateTime, TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity as AccessEntity,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
struct FakeRemindersService;
impl RemindersService for FakeRemindersService {
    async fn list_email_reminders(
        &self,
        _: crate::domain::email_collection::EmailReminderViewer,
        _: crate::domain::email_collection::EmailReminderQuery,
    ) -> Result<crate::domain::email_collection::EmailReminderPage, ReminderError> {
        unreachable!()
    }
    async fn get_email_followup(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
    ) -> Result<Option<crate::domain::email_followup::EmailFollowup>, ReminderError> {
        unreachable!()
    }
    async fn execute_email_followup(
        &self,
        _: MacroUserIdStr<'static>,
        _: Uuid,
        _: crate::domain::email_followup::EmailFollowupCommand,
    ) -> Result<crate::domain::email_followup::EmailFollowup, ReminderError> {
        unreachable!()
    }
}
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

#[cfg(feature = "postgres")]
mod email_collection;

const USER_ID: &str = "macro|reminders-user@macro.com";
const VALID_JWT: &str = "valid";
/// The one entity the fake access service grants view access to.
// Entity ids are uuids: `reminder.entity_id` is a uuid column, and the router
// rejects anything that does not parse.
const ACCESSIBLE_DOC: &str = "11111111-1111-4111-8111-111111111111";

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
    allowed_emails: Option<Arc<Mutex<std::collections::HashSet<Uuid>>>>,
    denial: Option<fn() -> AccessError>,
}

impl FakeEntityAccessService {
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

        let allowed_email = entity_type == EntityType::EmailThread
            && self.allowed_emails.as_ref().is_some_and(|ids| {
                entity_id
                    .parse()
                    .is_ok_and(|id| ids.lock().unwrap().contains(&id))
            });
        if entity_id != ACCESSIBLE_DOC && !allowed_email {
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
        Err(AccessError::internal("test access failure"))
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
            return Ok(Some(AccessLevel::Owner));
        }
        Err(AccessError::internal("test access failure"))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }
}

fn build_router(access: FakeEntityAccessService) -> axum::Router {
    reminders_router(RemindersRouterState::new(
        Arc::new(FakeRemindersService),
        Arc::new(access),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

fn authed(builder: axum::http::request::Builder) -> axum::http::request::Builder {
    builder.header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"))
}

#[tokio::test]
async fn generic_reminder_routes_are_removed() {
    for (method, path) in [
        ("POST", "/"),
        ("GET", "/"),
        ("GET", "/collection"),
        ("GET", "/11111111-1111-4111-8111-111111111111"),
        ("PATCH", "/11111111-1111-4111-8111-111111111111"),
        ("DELETE", "/11111111-1111-4111-8111-111111111111"),
    ] {
        let response = build_router(FakeEntityAccessService::default())
            .oneshot(
                authed(axum::http::Request::builder().method(method).uri(path))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
    }
}
