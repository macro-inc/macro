//! Permission service implementation for properties.

use std::sync::Arc;

use entity_access::domain::models::AccessError;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as ModelEntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::permission_queries;
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
        let model_entity_type = match map_entity_type(entity_type) {
            Some(t) => t,
            None => {
                tracing::warn!("property operations not supported for this entity type");
                anyhow::bail!("Unsupported entity type");
            }
        };

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
            && let Ok(Some(owner_id)) =
                permission_queries::get_macro_id_from_thread_id(&self.db, thread_id).await
            && owner_id == user_id.as_ref()
        {
            tracing::debug!("user owns thread via link_id, granting owner access");
            return Ok(Some(AccessLevel::Owner));
        }

        Ok(access_level)
    }
}

/// Map `models_properties::EntityType` to `model_entity::EntityType`.
fn map_entity_type(entity_type: EntityType) -> Option<ModelEntityType> {
    match entity_type {
        EntityType::Document => Some(ModelEntityType::Document),
        EntityType::Chat => Some(ModelEntityType::Chat),
        EntityType::Project => Some(ModelEntityType::Project),
        EntityType::Thread => Some(ModelEntityType::EmailThread),
        EntityType::Channel => Some(ModelEntityType::Channel),
        EntityType::Task => Some(ModelEntityType::Document), // tasks use document permissions
        // CRM company access is resolved from the owning team's membership
        // (member → View, admin → Edit, owner → Owner).
        EntityType::Company => Some(ModelEntityType::CrmCompany),
        EntityType::User => None,
    }
}

impl<Svc: EntityAccessService> PermissionService for PermissionServiceImpl<Svc> {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), fields(user_id = %user_id, entity_id = %entity_id, entity_type = ?entity_type), err)]
    async fn check_entity_edit_permission(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(), Self::Err> {
        match self
            .get_access_level(Some(user_id), entity_id, entity_type)
            .await?
        {
            Some(AccessLevel::Edit) | Some(AccessLevel::Owner) => Ok(()),
            Some(_) | None => anyhow::bail!("Access denied"),
        }
    }

    #[tracing::instrument(skip(self), fields(user_id = ?user_id, entity_id = %entity_id, entity_type = ?entity_type), err)]
    async fn check_entity_view_permission(
        &self,
        user_id: Option<&MacroUserIdStr<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(), Self::Err> {
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
                    return Ok(());
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
            Some(_) => Ok(()), // Any access level is sufficient for viewing
            None => anyhow::bail!("Access denied"),
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

    #[tracing::instrument(skip(self), err)]
    async fn get_owner_and_deleted(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(String, bool), Self::Err> {
        permission_queries::get_owner_and_deleted(&self.db, entity_id, entity_type).await
    }
}
