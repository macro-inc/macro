use axum::http::StatusCode;
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::{EntityReference, EntityType};
use thiserror::Error;

use crate::api::context::ApiContext;

#[derive(Debug, Error)]
pub enum PermissionError {
    #[error("Unsupported entity type")]
    UnsupportedEntityType,

    #[error("Access denied")]
    Unauthorized,

    #[error("An internal error occurred")]
    InternalError(String),
}

impl PermissionError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            PermissionError::UnsupportedEntityType => StatusCode::FORBIDDEN,
            PermissionError::Unauthorized => StatusCode::FORBIDDEN,
            PermissionError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// Checks if a user has view access to an entity (View, Comment, Edit, or Owner level).
/// Supports: Document, Chat, Project, Thread, Channel, Macro.
/// For anonymous users (empty user_id), only allows access to publicly shared entities.
#[tracing::instrument(skip(context), fields(user_id = %user_id, entity_id = %entity_ref.entity_id, entity_type = ?entity_ref.entity_type), err)]
pub async fn check_entity_view_permission(
    context: &ApiContext,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<(), PermissionError> {
    let access_level = get_access_level(context, user_id, entity_ref).await?;

    match access_level {
        Some(_) => Ok(()), // Any access level is sufficient for viewing
        None => Err(PermissionError::Unauthorized),
    }
}

/// Checks if a user has edit access to an entity (Edit or Owner level).
/// Supports: Document, Chat, Project, Thread, Channel, Macro.
#[tracing::instrument(skip(context), fields(user_id = %user_id, entity_id = %entity_ref.entity_id, entity_type = ?entity_ref.entity_type), err)]
pub async fn check_entity_edit_permission(
    context: &ApiContext,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<(), PermissionError> {
    let access_level = get_access_level(context, user_id, entity_ref).await?;

    match access_level {
        Some(AccessLevel::Edit) | Some(AccessLevel::Owner) => Ok(()),
        Some(_) | None => Err(PermissionError::Unauthorized),
    }
}

/// Internal: Gets the user's access level for an entity.
///
/// NOTE: Makes a separate DB query (+ HTTP call for channels). Not worth inlining into
/// properties query due to complex recursive CTEs and entity-specific permission logic.
#[tracing::instrument(skip(context), fields(user_id = %user_id, entity_id = %entity_ref.entity_id, entity_type = ?entity_ref.entity_type), err)]
async fn get_access_level(
    context: &ApiContext,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<Option<AccessLevel>, PermissionError> {
    let item_type = match entity_ref.entity_type {
        EntityType::Document => "document",
        EntityType::Chat => "chat",
        EntityType::Project => "project",
        EntityType::Thread => "thread",
        EntityType::Channel => "channel",
        EntityType::Task => "document",
        EntityType::Company | EntityType::User => {
            tracing::warn!("property operations not supported for this entity type");
            return Err(PermissionError::UnsupportedEntityType);
        }
    };

    let access_level = macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
        &context.db,
        &context.comms_service_client,
        user_id,
        &entity_ref.entity_id,
        item_type,
    )
    .await
    .map_err(|(status_code, message)| {
        tracing::error!(
            status_code = ?status_code,
            message = %message,
            "failed to get user access level"
        );
        PermissionError::InternalError(message)
    })?;

    // Fallback for threads: check ownership via link_id if no permission records exist.
    // This handles owned threads where EmailThreadPermission/UserItemAccess were never created.
    if access_level.is_none()
        && entity_ref.entity_type == EntityType::Thread
        && let Ok(thread_id) = uuid::Uuid::parse_str(&entity_ref.entity_id)
        && let Ok(Some(owner_id)) =
            email_db_client::threads::get::get_macro_id_from_thread_id(&context.db, thread_id).await
        && owner_id == user_id
    {
        tracing::debug!("user owns thread via link_id, granting owner access");
        return Ok(Some(AccessLevel::Owner));
    }

    Ok(access_level)
}
