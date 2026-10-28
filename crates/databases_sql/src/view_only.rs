//! Entity access capped at view: every permission the inner service resolves
//! is lowered to the weakest that still sees the entity, so no receipt this
//! hands out can edit. A surface whose answers must never write runs the SQL
//! tool over this instead of a second, read-only tool.

#[cfg(test)]
mod test;

use bot_id::BotId;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use uuid::Uuid;

/// `Access`, with every grant read as view.
#[derive(Debug, Clone)]
pub struct ViewOnlyAccess<Access>(pub Access);

/// The weakest permission of the same kind as `permission`.
fn capped(permission: &EntityPermission) -> EntityPermission {
    match permission {
        EntityPermission::AccessLevel { access_level } => EntityPermission::AccessLevel {
            access_level: (*access_level).min(AccessLevel::View),
        },
        EntityPermission::ChannelViewOnly | EntityPermission::ChannelRole { .. } => {
            EntityPermission::ChannelViewOnly
        }
        EntityPermission::TeamRole { .. } => EntityPermission::TeamRole {
            role: TeamRole::Member,
        },
    }
}

/// `receipt`, re-checked against `Required` with its permission capped.
fn capped_receipt<Required: RequiredPermission>(
    receipt: EntityAccessReceipt<Required>,
) -> Result<EntityAccessReceipt<Required>, AccessError> {
    EntityAccessReceipt::try_new(
        receipt.auth().clone(),
        receipt.entity().clone(),
        capped(receipt.entity_permission()),
    )
}

/// `level` unless `required` asks for more than view.
fn capped_level(level: AccessLevel, required: AccessLevel) -> Result<AccessLevel, AccessError> {
    if required > AccessLevel::View {
        return Err(AccessError::Unauthorized);
    }
    Ok(level.min(AccessLevel::View))
}

impl<Access: EntityAccessService> EntityAccessService for ViewOnlyAccess<Access> {
    async fn generate_entity_access_receipt<Required: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<Required>, AccessError> {
        let receipt = self
            .0
            .generate_entity_access_receipt::<Required>(
                user_id,
                user_org_id,
                entity_id,
                entity_type,
            )
            .await?;
        capped_receipt(receipt)
    }

    async fn generate_bot_entity_access_receipt<Required: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<Required>, AccessError> {
        let receipt = self
            .0
            .generate_bot_entity_access_receipt::<Required>(bot_id, scope, entity_id, entity_type)
            .await?;
        capped_receipt(receipt)
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let level = self
            .0
            .get_access_level(user_id, entity_id, entity_type)
            .await?;
        Ok(level.map(|level| level.min(AccessLevel::View)))
    }

    async fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let level = self
            .0
            .check_access(user_id, entity_id, entity_type, required_level)
            .await?;
        capped_level(level, required_level)
    }

    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let level = self
            .0
            .check_public_access(entity_id, entity_type, required_level)
            .await?;
        capped_level(level, required_level)
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        let permission = self
            .0
            .get_entity_permission(user_id, entity_id, entity_type, user_org_id)
            .await?;
        Ok(capped(&permission))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        let (permission, team_id, _) = self
            .0
            .get_crm_entity_permission_with_team(user_id, entity_id, entity_type)
            .await?;
        Ok((capped(&permission), team_id, TeamRole::Member))
    }

    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        self.0.get_users_by_entity(entity_id, entity_type).await
    }

    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.0.get_call_channel(call_id).await
    }

    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.0.get_call_channel_by_channel_id(channel_id).await
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        let team = self.0.get_user_team(user_id).await?;
        Ok(team.map(|team| UserTeamInfo {
            role: TeamRole::Member,
            ..team
        }))
    }
}
