use cowlike::CowLike as _;
use entity_access::domain::{
    models::{
        AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityPermission, EntityType,
        ParticipantRole, RequiredPermission, TeamRole, UserTeamInfo,
    },
    ports::NoOpEntityAccessService,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use uuid::Uuid;

use super::*;

const USER_ID: &str = "macro|favorites-authorizer@example.com";

/// Entity access that answers one entity kind with one permission, built
/// through the same validating constructor the real service uses.
#[derive(Clone)]
struct PermittingAccessService(EntityPermission);

impl EntityAccessService for PermittingAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr(user_id.clone().into_owned()),
            entity_access::domain::models::Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            self.0,
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        NoOpEntityAccessService
            .generate_bot_entity_access_receipt(bot_id, scope, entity_id, entity_type)
            .await
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        NoOpEntityAccessService
            .get_access_level(user_id, entity_id, entity_type)
            .await
    }

    async fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        NoOpEntityAccessService
            .check_access(user_id, entity_id, entity_type, required_level)
            .await
    }

    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        NoOpEntityAccessService
            .check_public_access(entity_id, entity_type, required_level)
            .await
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        NoOpEntityAccessService
            .get_entity_permission(user_id, entity_id, entity_type, user_org_id)
            .await
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        NoOpEntityAccessService
            .get_crm_entity_permission_with_team(user_id, entity_id, entity_type)
            .await
    }

    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        NoOpEntityAccessService
            .get_users_by_entity(entity_id, entity_type)
            .await
    }

    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        NoOpEntityAccessService.get_call_channel(call_id).await
    }

    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        NoOpEntityAccessService
            .get_call_channel_by_channel_id(channel_id)
            .await
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        NoOpEntityAccessService.get_user_team(user_id).await
    }
}

fn actor() -> FavoritesMutationActor {
    FavoritesMutationActor {
        user_id: MacroUserIdStr::parse_from_str(USER_ID).expect("valid user id"),
        organization_id: Some(42),
    }
}

#[tokio::test]
async fn channel_permissions_authorize_a_favorite() {
    for permission in [
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
        EntityPermission::ChannelViewOnly,
    ] {
        let service = PermittingAccessService(permission);
        let entity = EntityType::Channel.with_entity_string("channel-1".to_string());

        let receipt = service
            .authorize_favorite(&actor(), &entity)
            .await
            .expect("a channel the actor can see is favoritable");

        assert_eq!(receipt.entity().entity_id, "channel-1");
    }
}

#[tokio::test]
async fn item_access_levels_still_authorize_a_favorite() {
    let service = PermittingAccessService(EntityPermission::AccessLevel {
        access_level: AccessLevel::View,
    });
    let entity = EntityType::Document.with_entity_string("document-1".to_string());

    let receipt = service
        .authorize_favorite(&actor(), &entity)
        .await
        .expect("a document the actor can view is favoritable");

    assert_eq!(receipt.entity().entity_id, "document-1");
}
