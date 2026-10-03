use super::*;
use entity_access::domain::models::{
    AccessLevel, BotAccessScope, BotId, CallChannelInfo, Entity, EntityAccessReceipt,
    EntityPermission, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use macro_uuid::{Uuid, generate_uuid_v7};
use serde_json::json;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct AccessService {
    permission: EntityPermission,
    calls: Arc<Mutex<Vec<(String, String, EntityType)>>>,
}
impl EntityAccessService for AccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        org: Option<i64>,
        id: &str,
        kind: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        assert_eq!(org, None);
        self.calls
            .lock()
            .unwrap()
            .push((user.as_ref().to_string(), id.into(), kind));
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(user.as_ref().to_string()).unwrap(),
            Entity {
                entity_id: id.into(),
                entity_type: kind,
            },
            self.permission,
        )
    }
    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _: BotId,
        _: BotAccessScope,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unreachable!()
    }
    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!()
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unreachable!()
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unreachable!()
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unreachable!()
    }
}

#[tokio::test]
async fn mints_entity_specific_receipts_for_exact_owner_and_entity() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for (name, kind, permission) in [
        (
            "document.updated",
            EntityType::Document,
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        ),
        (
            "channel.created",
            EntityType::Channel,
            EntityPermission::ChannelViewOnly,
        ),
        (
            "channel.created",
            EntityType::Channel,
            EntityPermission::ChannelRole {
                role: entity_access::domain::models::ParticipantRole::Member,
            },
        ),
    ] {
        let service = AccessService {
            permission,
            calls: Arc::default(),
        };
        let adapter = EventAccessAdapter::new(service.clone());
        let event: EventReference = serde_json::from_value(json!({"event_id":generate_uuid_v7(), "event_name":name, "entity_id":generate_uuid_v7(), "message_id":null})).unwrap();
        let receipt = adapter.authorize(&owner, &event).await.unwrap().unwrap();
        assert!(receipt.authorizes(&owner, &event));
        assert_eq!(
            *service.calls.lock().unwrap(),
            vec![(owner.to_string(), event.entity_id().to_string(), kind)]
        );
    }
}

#[tokio::test]
async fn wrong_permission_family_is_denied_not_reinterpreted() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for (name, permission) in [
        ("document.updated", EntityPermission::ChannelViewOnly),
        (
            "channel.created",
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        ),
    ] {
        let adapter = EventAccessAdapter::new(AccessService {
            permission,
            calls: Arc::default(),
        });
        let event = serde_json::from_value(json!({"event_id":generate_uuid_v7(), "event_name":name, "entity_id":generate_uuid_v7(), "message_id":null})).unwrap();
        assert!(adapter.authorize(&owner, &event).await.unwrap().is_none());
    }
}

#[test]
fn denial_and_missing_entities_are_distinct_from_infrastructure_failures() {
    for error in [
        AccessError::Unauthorized,
        AccessError::UnauthorizedWithMessage("denied"),
        AccessError::NotFound("missing"),
    ] {
        assert!(access_result::<()>(Err(error)).unwrap().is_none());
    }
    for error in [
        AccessError::Unavailable(rootcause::report!("offline")),
        AccessError::internal("broken"),
        AccessError::BadRequest("invalid"),
    ] {
        assert!(access_result::<()>(Err(error)).is_err());
    }
}
