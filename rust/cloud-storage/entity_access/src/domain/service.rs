//! Entity access service implementation.

use std::marker::PhantomData;
use std::str::FromStr;

use crate::domain::{
    models::{
        AccessError, AccessLevel, CallChannelInfo, ChannelRoleResult, CrmEntityAccess, Entity,
        EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
        UserTeamInfo,
    },
    ports::{AccessRepository, EntityAccessService},
};
use macro_user_id::{
    cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr,
};
use uuid::Uuid;

/// Implementation of the [`EntityAccessService`].
///
/// This service orchestrates access checks by:
/// 1. Delegating to [`AccessRepository`] for database queries
/// 2. Applying business rules (owner always has access, etc.)
#[derive(Clone)]
pub struct EntityAccessServiceImpl<R> {
    repo: R,
}

impl<R> EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    /// Create a new entity access service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Get access level for optimized entity types (document, chat, project, thread).
    async fn get_optimized_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document => self.repo.get_document_access(entity_id, user_id).await,
            EntityType::Chat => self.repo.get_chat_access(entity_id, user_id).await,
            EntityType::Project => self.repo.get_project_access(entity_id, user_id).await,
            EntityType::EmailThread => self.repo.get_thread_access(entity_id, user_id).await,
            EntityType::Call => self.repo.get_call_access(entity_id, user_id).await,
            _ => unreachable!("Only optimized types should call this method"),
        }
    }

    /// Get access level for a channel.
    ///
    /// Channel access is binary - members get View access, non-members get None.
    async fn get_channel_access(
        &self,
        channel_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let channel_uuid = Uuid::from_str(channel_id)
            .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;

        let user_channels = self
            .repo
            .check_user_channel_membership(user_id, &[channel_uuid])
            .await?;

        if user_channels.contains(&channel_uuid) {
            Ok(Some(AccessLevel::View))
        } else {
            Ok(None)
        }
    }

    /// Get access level for a foreign entity.
    ///
    /// Foreign entity access is binary and always maps to View access.
    async fn get_foreign_entity_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let has_access = self
            .repo
            .has_foreign_entity_access(entity_id, user_id)
            .await?;

        if has_access {
            Ok(Some(AccessLevel::View))
        } else {
            Ok(None)
        }
    }

    /// Get access level + owning team for a CRM company via the user's team
    /// membership.
    async fn get_crm_company_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        self.repo.get_crm_company_access(entity_id, user_id).await
    }

    /// Get access level + owning team for a CRM contact via its parent
    /// company's team.
    async fn get_crm_contact_access(
        &self,
        entity_id: &str,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
    ) -> Result<Option<CrmEntityAccess>, AccessError> {
        self.repo.get_crm_contact_access(entity_id, user_id).await
    }

    /// Resolve a call id string to the channel id that owns it.
    ///
    /// Looks up both the active `calls` table and the archived `call_records`
    /// table. Returns `NotFound` if neither has a matching row, or
    /// `BadRequest` if the id is not a valid UUID.
    async fn resolve_call_channel_id(&self, call_id: &str) -> Result<Uuid, AccessError> {
        let call_uuid = Uuid::from_str(call_id)
            .map_err(|_| AccessError::BadRequest("Invalid call ID format"))?;
        let info = self
            .repo
            .get_call_channel(&call_uuid)
            .await?
            .ok_or(AccessError::NotFound("Call not found"))?;
        Ok(info.channel_id)
    }
}

impl<R> EntityAccessService for EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let entity_permission = self
            .get_entity_permission(Some(user_id), entity_id, entity_type, user_org_id)
            .await?;

        if !entity_permission.satisfies::<T>() {
            return Err(AccessError::Unauthorized);
        }

        Ok(EntityAccessReceipt {
            auth: EntityAccessAuth::Authenticated(MacroUserIdStr(user_id.clone().into_owned())),
            entity: Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            entity_permission,
            _marker: PhantomData,
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::Call => {
                self.get_optimized_access(entity_id, user_id, entity_type)
                    .await
            }
            EntityType::Channel => self.get_channel_access(entity_id, user_id).await,
            EntityType::ForeignEntity => self.get_foreign_entity_access(entity_id, user_id).await,
            EntityType::CrmCompany => Ok(self
                .get_crm_company_access(entity_id, user_id)
                .await?
                .map(|a| a.access_level)),
            EntityType::CrmContact => Ok(self
                .get_crm_contact_access(entity_id, user_id)
                .await?
                .map(|a| a.access_level)),
            // Static files are always viewable. This is wrong for owners
            EntityType::StaticFile => Ok(Some(AccessLevel::View)),
            // These entity types don't have access checks implemented yet.
            EntityType::Team | EntityType::User => Ok(None),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_access(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let access_level = self
            .get_access_level(user_id, entity_id, entity_type)
            .await?;

        match access_level {
            Some(level) if level >= required_level => Ok(level),
            Some(_) => Err(AccessError::Unauthorized),
            None => Err(AccessError::Unauthorized),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_public_access(
        &self,
        entity_id: &str,
        entity_type: EntityType,
        required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        let access_level = self.get_access_level(None, entity_id, entity_type).await?;

        match access_level {
            Some(level) if level >= required_level => Ok(level),
            Some(_) | None => Err(AccessError::Unauthorized),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread
            | EntityType::Call => {
                let access = self
                    .get_optimized_access(entity_id, user_id, entity_type)
                    .await?;
                match access {
                    Some(level) => Ok(EntityPermission::AccessLevel {
                        access_level: level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::ForeignEntity => {
                let access = self.get_foreign_entity_access(entity_id, user_id).await?;
                match access {
                    Some(level) => Ok(EntityPermission::AccessLevel {
                        access_level: level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::CrmCompany => {
                let access = self.get_crm_company_access(entity_id, user_id).await?;
                match access {
                    Some(access) => Ok(EntityPermission::AccessLevel {
                        access_level: access.access_level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::CrmContact => {
                let access = self.get_crm_contact_access(entity_id, user_id).await?;
                match access {
                    Some(access) => Ok(EntityPermission::AccessLevel {
                        access_level: access.access_level,
                    }),
                    None => Err(AccessError::Unauthorized),
                }
            }
            EntityType::Channel => {
                let channel_uuid = Uuid::from_str(entity_id)
                    .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;

                let result = self
                    .repo
                    .get_channel_role(&channel_uuid, user_id, user_org_id)
                    .await?;
                channel_role_result_to_permission(result)
            }
            _ => Err(AccessError::BadRequest("Unsupported entity type")),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
        // Resolve permission and owning team from one ownership lookup, so the
        // team is the entity's owner (and the user is a member of it) rather
        // than the user's default team.
        let access = match entity_type {
            EntityType::CrmCompany => self.get_crm_company_access(entity_id, user_id).await?,
            EntityType::CrmContact => self.get_crm_contact_access(entity_id, user_id).await?,
            _ => {
                return Err(AccessError::BadRequest(
                    "get_crm_entity_permission_with_team supports only CRM entities",
                ));
            }
        };
        let access = access.ok_or(AccessError::Unauthorized)?;
        Ok((
            EntityPermission::AccessLevel {
                access_level: access.access_level,
            },
            access.team_id,
        ))
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread => {
                let entity_id = Uuid::parse_str(entity_id).map_err(|_| {
                    AccessError::BadRequest("invalid entity_id for get_users_by_entity")
                })?;

                self.repo.get_entity_users(&entity_id, entity_type).await
            }
            EntityType::Channel => {
                let channel_id = Uuid::parse_str(entity_id).map_err(|_| {
                    AccessError::BadRequest("invalid channel_id for get_users_by_entity")
                })?;
                self.repo.get_channel_users(&channel_id).await
            }
            EntityType::Call => {
                // Participants of a call are the members of its channel.
                let channel_id = self.resolve_call_channel_id(entity_id).await?;
                self.repo.get_channel_users(&channel_id).await
            }
            _ => Err(AccessError::BadRequest(
                "get_users_by_entity does not support this entity type",
            )),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel(
        &self,
        call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.repo.get_call_channel(call_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_call_channel_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        self.repo.get_call_channel_by_channel_id(channel_id).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        self.repo.get_user_team(user_id).await
    }
}

fn channel_role_result_to_permission(
    result: ChannelRoleResult,
) -> Result<EntityPermission, AccessError> {
    match result {
        ChannelRoleResult::Role(role) => Ok(EntityPermission::ChannelRole { role }),
        ChannelRoleResult::NoAccess => Err(AccessError::Unauthorized),
        ChannelRoleResult::NotFound => Err(AccessError::NotFound("Channel not found")),
    }
}

#[cfg(test)]
mod test;
