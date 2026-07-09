//! Permission service implementation for properties.

use std::sync::Arc;

use entity_access::domain::models::{AccessError, EntityAccessAuth};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::permission_queries;
use crate::domain::model::{EditReceipt, PropertiesAccessReceipt, ViewReceipt, access_entity_type};
use crate::domain::ports::PermissionService;

/// Permission service implementation using database.
pub struct PermissionServiceImpl<Svc> {
    db: Pool<Postgres>,
    entity_access_service: Arc<Svc>,
}

impl<Svc: EntityAccessService> PermissionServiceImpl<Svc> {
    pub fn new(db: Pool<Postgres>, entity_access_service: Arc<Svc>) -> Self {
        Self {
            db,
            entity_access_service,
        }
    }

    /// Gets the user's access level for an entity, including the thread
    /// ownership fallback for owned threads where permission records were
    /// never created.
    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserIdStr<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> anyhow::Result<Option<AccessLevel>> {
        if entity_type == EntityType::User {
            tracing::warn!("property operations not supported for this entity type");
            anyhow::bail!("Unsupported entity type");
        }
        let model_entity_type = access_entity_type(entity_type);

        let user_id_ref = user_id.map(std::ops::Deref::deref);

        let access_level = self
            .entity_access_service
            .get_access_level(user_id_ref, entity_id, model_entity_type)
            .await
            .map_err(|e: AccessError| {
                tracing::error!(
                    error = ?e,
                    "failed to get user access level"
                );
                anyhow::anyhow!("Failed to get user access level: {}", e)
            })?;

        // Fallback for threads: check ownership via link_id if no permission records exist.
        // This handles owned threads where EmailThreadPermission/UserItemAccess were never created.
        if access_level.is_none()
            && entity_type == EntityType::Thread
            && let Some(user_id) = user_id
            && let Ok(thread_id) = Uuid::parse_str(entity_id)
        {
            match permission_queries::get_macro_id_from_thread_id(&self.db, thread_id).await {
                Ok(Some(owner_id)) if owner_id == user_id.as_ref() => {
                    tracing::debug!("user owns thread via link_id, granting owner access");
                    return Ok(Some(AccessLevel::Owner));
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!(
                        error = ?e,
                        thread_id = %thread_id,
                        "failed to look up thread owner for permission fallback"
                    );
                }
            }
        }

        Ok(access_level)
    }
}

/// The auth an authenticated or anonymous caller mints receipts under.
fn caller_auth(user_id: Option<&MacroUserIdStr<'_>>) -> EntityAccessAuth {
    match user_id {
        Some(user_id) => EntityAccessAuth::Authenticated(user_id.copied().into_owned()),
        None => EntityAccessAuth::Unauthenticated,
    }
}

impl<Svc: EntityAccessService> PermissionService for PermissionServiceImpl<Svc> {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), fields(user_id = ?user_id, entity_id = %entity_id, entity_type = ?entity_type), err)]
    async fn mint_view_receipt<'a>(
        &self,
        user_id: Option<&'a MacroUserIdStr<'a>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<ViewReceipt, Self::Err> {
        // Check if entity is deleted: the owner always has access, and deleted
        // entities are only visible to their owner.
        match entity_type {
            EntityType::Channel | EntityType::Company | EntityType::User | EntityType::Thread => {}
            _ => {
                let (owner, deleted) =
                    permission_queries::get_owner_and_deleted(&self.db, entity_id, entity_type)
                        .await?;

                // If you are the owner fast return
                if user_id.is_some_and(|u| owner == u.as_ref()) {
                    return Ok(PropertiesAccessReceipt::try_from_permission(
                        caller_auth(user_id),
                        entity_id,
                        entity_type,
                        AccessLevel::Owner,
                    )?);
                }

                // If the item is deleted and you aren't the owner you are unauthorized
                if deleted {
                    anyhow::bail!("Access denied");
                }
            }
        }

        match self
            .get_access_level(user_id, entity_id, entity_type)
            .await?
        {
            // Any access level is sufficient for viewing
            Some(access_level) => Ok(PropertiesAccessReceipt::try_from_permission(
                caller_auth(user_id),
                entity_id,
                entity_type,
                access_level,
            )?),
            None => anyhow::bail!("Access denied"),
        }
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, entity_id = %entity_id, entity_type = ?entity_type), err)]
    async fn mint_edit_receipt<'a>(
        &self,
        user_id: &MacroUserIdStr<'a>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EditReceipt, Self::Err> {
        match self
            .get_access_level(Some(user_id), entity_id, entity_type)
            .await?
        {
            Some(access_level @ (AccessLevel::Edit | AccessLevel::Owner)) => {
                Ok(PropertiesAccessReceipt::try_from_permission(
                    caller_auth(Some(user_id)),
                    entity_id,
                    entity_type,
                    access_level,
                )?)
            }
            Some(_) | None => anyhow::bail!("Access denied"),
        }
    }

    #[tracing::instrument(skip(self), fields(task_id = %task_id, user_count = user_ids.len()), err)]
    async fn grant_permissions_to_task(
        &self,
        user_ids: &[MacroUserIdStr<'_>],
        task_id: &str,
    ) -> Result<(), Self::Err> {
        if user_ids.is_empty() {
            return Ok(());
        }

        // Grant edit permissions to all users
        entity_access_db_utils::upsert_user_entity_access_bulk(
            &self.db,
            user_ids,
            &macro_uuid::string_to_uuid(task_id).unwrap(),
            model_entity::EntityType::Document,
            AccessLevel::Edit,
        )
        .await?;

        Ok(())
    }
}
