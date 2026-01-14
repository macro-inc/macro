//! Entity access service implementation.

use crate::domain::{
    models::{AccessError, AccessLevel, EntityType},
    ports::{AccessRepository, EntityAccessService},
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use std::str::FromStr;
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
    ///
    /// These use the UserItemAccess table for efficient lookups.
    async fn get_optimized_access(
        &self,
        entity_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document => self.repo.get_document_access(entity_id, user_id).await,
            EntityType::Chat => self.repo.get_chat_access(entity_id, user_id).await,
            EntityType::Project => self.repo.get_project_access(entity_id, user_id).await,
            EntityType::EmailThread => self.repo.get_thread_access(entity_id, user_id).await,
            _ => unreachable!("Only optimized types should call this method"),
        }
    }

    /// Get access level for a channel.
    ///
    /// Channel access is binary - members get View access, non-members get None.
    async fn get_channel_access(
        &self,
        channel_id: &str,
        user_id: &MacroUserId<Lowercase<'_>>,
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
}

impl<R> EntityAccessService for EntityAccessServiceImpl<R>
where
    R: AccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn get_access_level(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        match entity_type {
            EntityType::Document
            | EntityType::Chat
            | EntityType::Project
            | EntityType::EmailThread => {
                self.get_optimized_access(entity_id, user_id, entity_type)
                    .await
            }
            EntityType::Channel => self.get_channel_access(entity_id, user_id).await,
            // These entity types don't have access checks implemented yet
            EntityType::Email | EntityType::Team | EntityType::User => Ok(None),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn check_access(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
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
}

#[cfg(test)]
mod test;
