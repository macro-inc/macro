use super::*;

use entity_access::domain::models::{
    AccessLevel, BotId, CallChannelInfo, EntityAccessAuth, EntityPermission, RequiredPermission,
    TeamRole, UserTeamInfo,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use uuid::Uuid;

/// Grants edit access on every entity to the listed users and nobody else.
#[derive(Clone)]
struct EditorsOnly {
    editors: Vec<&'static str>,
}

impl EntityAccessService for EditorsOnly {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if !self.editors.contains(&user_id.as_ref()) {
            return Err(AccessError::Unauthorized);
        }
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(user_id.as_ref().to_string())
                .expect("test user id should be valid"),
            entity_access::domain::models::Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
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
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
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

#[tokio::test]
async fn status_change_is_credited_to_a_user_who_can_edit_the_task() {
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_internal_user(
        "task-1",
        EntityType::Document,
    );
    let merger = MacroUserIdStr::parse_from_str("macro|merger@example.com").unwrap();
    let entity_access = EditorsOnly {
        editors: vec!["macro|merger@example.com"],
    };

    let receipt = credited_task_edit_receipt(&entity_access, &access, Some(&merger)).await;

    assert!(
        matches!(receipt.auth(), EntityAccessAuth::Authenticated(user) if *user == merger),
        "expected the merger's receipt, got {:?}",
        receipt.auth()
    );
    assert_eq!(receipt.entity().entity_id, "task-1");
}

#[tokio::test]
async fn status_change_stays_uncredited_when_the_user_cannot_edit_the_task() {
    let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_internal_user(
        "task-1",
        EntityType::Document,
    );
    let merger = MacroUserIdStr::parse_from_str("macro|merger@example.com").unwrap();
    let entity_access = EditorsOnly { editors: vec![] };

    let receipt = credited_task_edit_receipt(&entity_access, &access, Some(&merger)).await;

    assert!(
        matches!(receipt.auth(), EntityAccessAuth::Internal),
        "expected the caller's internal receipt, got {:?}",
        receipt.auth()
    );
    assert_eq!(receipt.entity().entity_id, "task-1");
}
