use crate::domain::{
    models::{AccessError, AccessLevel, EntityType, SharePermissionInfo},
    ports::{AccessRepo, EntityAccessService},
};
use std::str::FromStr;
use uuid::Uuid;

/// Implementation of the [`EntityAccessService`].
///
/// This service orchestrates access checks by:
/// 1. Delegating to [`AccessRepo`] for database queries
/// 2. Using [`ChannelMembershipService`] for channel-based permissions
/// 3. Applying business rules (owner always has access, etc.)
pub struct EntityAccessServiceImpl<R> {
    access_repo: R,
}

impl<R, C> EntityAccessServiceImpl<R>
where
    R: AccessRepo,
{
    /// Create a new entity access service.
    pub fn new(access_repo: R) -> Self {
        Self { access_repo }
    }

    /// Internal method to get access level for optimized entity types.
    ///
    /// These use the UserItemAccess table for efficient lookups.
    async fn get_optimized_access(
        &self,
        entity_id: &str,
        user_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let result = match entity_type {
            EntityType::Document => {
                self.access_repo
                    .get_document_access(entity_id, user_id)
                    .await
            }
            EntityType::Chat => self.access_repo.get_chat_access(entity_id, user_id).await,
            EntityType::Project => {
                self.access_repo
                    .get_project_access(entity_id, user_id)
                    .await
            }
            EntityType::Thread => self.access_repo.get_thread_access(entity_id, user_id).await,
            _ => unreachable!("Only optimized types should call this method"),
        };

        result.map_err(|e| AccessError::DatabaseError(e.into()))
    }

    /// Internal method to get access level for channel entity type.
    ///
    /// Simply checks channel membership - members get View access.
    async fn get_channel_access(
        &self,
        channel_id: &str,
        user_id: &str,
    ) -> Result<Option<AccessLevel>, AccessError> {
        let channel_uuid = Uuid::from_str(channel_id)
            .map_err(|_| AccessError::BadRequest("Invalid channel ID format"))?;

        let user_channels = self
            .channel_service
            .check_user_channels(user_id, &[channel_uuid])
            .await
            .map_err(AccessError::ExternalServiceError)?;

        if user_channels.contains(&channel_uuid) {
            Ok(Some(AccessLevel::View))
        } else {
            Ok(None)
        }
    }

    /// Calculate access level from a SharePermission record.
    ///
    /// Checks: ownership, public access, channel-based access.
    async fn calculate_access_from_permission(
        &self,
        user_id: &str,
        permission: &SharePermissionInfo,
    ) -> Result<Option<AccessLevel>, AccessError> {
        // Owner always has Owner access
        if permission.owner_id == user_id {
            return Ok(Some(AccessLevel::Owner));
        }

        let mut access_levels = Vec::new();

        // Check public access
        if permission.is_public {
            access_levels.push(permission.public_access_level.unwrap_or(AccessLevel::View));
        }

        // Check channel-based access
        if !permission.channel_permissions.is_empty() {
            let channel_ids: Vec<_> = permission
                .channel_permissions
                .iter()
                .map(|cp| cp.channel_id)
                .collect();

            let user_channels = self
                .channel_service
                .check_user_channels(user_id, &channel_ids)
                .await
                .map_err(AccessError::ExternalServiceError)?;

            for cp in &permission.channel_permissions {
                if user_channels.contains(&cp.channel_id) {
                    access_levels.push(cp.access_level);
                }
            }
        }

        // Return the highest access level found
        Ok(access_levels.into_iter().max())
    }
}

impl<R, C> EntityAccessService for EntityAccessServiceImpl<R>
where
    R: AccessRepo,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document | EntityType::Chat | EntityType::Project | EntityType::Thread => {
                self.get_optimized_access(entity_id, user_id, entity_type)
                    .await
            }
            EntityType::Channel => self.get_channel_access(entity_id, user_id).await,
            _ => unimplemented!("what the fuck"),
        }
    }
}
