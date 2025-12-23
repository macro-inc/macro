//! Permission service implementation for properties.

use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::EntityType;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::ports::PermissionService;
use comms_service_client::CommsServiceClient;
use email_db_client::threads::get::get_macro_id_from_thread_id;

/// Permission service implementation using database and comms service client.
pub struct PermissionServiceImpl {
    db: Pool<Postgres>,
    comms_service_client: CommsServiceClient,
}

impl PermissionServiceImpl {
    pub fn new(db: Pool<Postgres>, comms_service_client: CommsServiceClient) -> Self {
        Self {
            db,
            comms_service_client,
        }
    }
}

impl PermissionService for PermissionServiceImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), fields(user_id = %user_id, entity_id = %entity_id, entity_type = ?entity_type), err)]
    async fn check_entity_edit_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(), Self::Err> {
        let item_type = match entity_type {
            EntityType::Document => "document",
            EntityType::Chat => "chat",
            EntityType::Project => "project",
            EntityType::Thread => "thread",
            EntityType::Channel => "channel",
            EntityType::Task => "document",
            EntityType::Company | EntityType::User => {
                tracing::warn!("property operations not supported for this entity type");
                anyhow::bail!("Unsupported entity type");
            }
        };

        let access_level =
            macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
                &self.db,
                &self.comms_service_client,
                user_id,
                entity_id,
                item_type,
            )
            .await
            .map_err(|(status_code, message)| {
                tracing::error!(
                    status_code = ?status_code,
                    message = %message,
                    "failed to get user access level"
                );
                anyhow::anyhow!("Failed to get user access level: {}", message)
            })?;

        // Fallback for threads: check ownership via link_id if no permission records exist.
        // This handles owned threads where EmailThreadPermission/UserItemAccess were never created.
        if access_level.is_none()
            && entity_type == EntityType::Thread
            && let Ok(thread_id) = Uuid::parse_str(entity_id)
            && let Ok(Some(owner_id)) = get_macro_id_from_thread_id(&self.db, thread_id).await
            && owner_id == user_id
        {
            tracing::debug!("user owns thread via link_id, granting owner access");
            return Ok(());
        }

        match access_level {
            Some(AccessLevel::Edit) | Some(AccessLevel::Owner) => Ok(()),
            Some(_) | None => anyhow::bail!("Access denied"),
        }
    }
}
