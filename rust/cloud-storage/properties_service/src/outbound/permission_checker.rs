//! Permission checker implementation

use crate::domain::{
    error::PropertyError, error::Result, models::EntityType, ports::PermissionChecker,
};
use comms_service_client::CommsServiceClient;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;
use std::sync::Arc;

pub struct PgPermissionChecker {
    db: Arc<PgPool>,
    comms_client: Arc<CommsServiceClient>,
}

impl PgPermissionChecker {
    pub fn new(db: Arc<PgPool>, comms_client: Arc<CommsServiceClient>) -> Self {
        Self { db, comms_client }
    }
}

impl PermissionChecker for PgPermissionChecker {
    fn can_edit_entity(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send {
        let db = Arc::clone(&self.db);
        let comms_client = Arc::clone(&self.comms_client);
        let user_id = user_id.to_string();
        let entity_id = entity_id.to_string();

        async move {
            let item_type = match entity_type {
                EntityType::Document => "document",
                EntityType::Chat => "chat",
                EntityType::Project => "project",
                EntityType::Thread => "thread",
                EntityType::Channel => "channel",
                EntityType::User => {
                    return Err(PropertyError::PermissionDenied(
                        "Property operations not supported for User entity type".to_string(),
                    ));
                }
            };

            let access_level =
                macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
                    &db,
                    &comms_client,
                    &user_id,
                    &entity_id,
                    item_type,
                )
                .await
                .map_err(|(_, message)| {
                    PropertyError::Internal(anyhow::anyhow!(
                        "Failed to get user access level: {}",
                        message
                    ))
                })?;

            match access_level {
                Some(AccessLevel::Edit) | Some(AccessLevel::Owner) => Ok(true),
                Some(_) | None => Ok(false),
            }
        }
    }

    fn can_view_entity(
        &self,
        user_id: &str,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = Result<bool>> + Send {
        let db = Arc::clone(&self.db);
        let comms_client = Arc::clone(&self.comms_client);
        let user_id = user_id.to_string();
        let entity_id = entity_id.to_string();

        async move {
            let item_type = match entity_type {
                EntityType::Document => "document",
                EntityType::Chat => "chat",
                EntityType::Project => "project",
                EntityType::Thread => "thread",
                EntityType::Channel => "channel",
                EntityType::User => {
                    return Err(PropertyError::PermissionDenied(
                        "Property operations not supported for User entity type".to_string(),
                    ));
                }
            };

            let access_level =
                macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
                    &db,
                    &comms_client,
                    &user_id,
                    &entity_id,
                    item_type,
                )
                .await
                .map_err(|(_, message)| {
                    PropertyError::Internal(anyhow::anyhow!(
                        "Failed to get user access level: {}",
                        message
                    ))
                })?;

            Ok(access_level.is_some())
        }
    }
}
