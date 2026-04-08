use axum::http::StatusCode;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType as ModelEntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::{EntityReference, EntityType};
use properties::PropertiesService;
use thiserror::Error;

use crate::api::context::PropertiesHandlerState;

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
    context: &PropertiesHandlerState,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<(), PermissionError> {
    // Check if entity is deleted
    match entity_ref.entity_type {
        EntityType::Channel | EntityType::Company | EntityType::User | EntityType::Thread => (),
        _ => {
            let (owner, deleted) = context
                .properties_service
                .get_owner_and_deleted(&entity_ref.entity_id, entity_ref.entity_type)
                .await
                .map_err(|e| PermissionError::InternalError(e.to_string()))?;

            // If you are the owner fast return
            if owner.eq(user_id) {
                return Ok(());
            }

            // If the item is deleted and you aren't the owner you are unauthorized
            if deleted {
                return Err(PermissionError::Unauthorized);
            }
        }
    }

    // If entity is deleted, if user is not owner return 401.
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
    context: &PropertiesHandlerState,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<(), PermissionError> {
    let access_level = get_access_level(context, user_id, entity_ref).await?;

    match access_level {
        Some(AccessLevel::Edit) | Some(AccessLevel::Owner) => Ok(()),
        Some(_) | None => Err(PermissionError::Unauthorized),
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
        EntityType::Company | EntityType::User => None,
    }
}

/// Internal: Gets the user's access level for an entity.
///
/// NOTE: Makes a separate DB query (+ HTTP call for channels). Not worth inlining into
/// properties query due to complex recursive CTEs and entity-specific permission logic.
#[tracing::instrument(skip(context), fields(user_id = %user_id, entity_id = %entity_ref.entity_id, entity_type = ?entity_ref.entity_type), err)]
async fn get_access_level(
    context: &PropertiesHandlerState,
    user_id: &str,
    entity_ref: &EntityReference,
) -> Result<Option<AccessLevel>, PermissionError> {
    let model_entity_type = match map_entity_type(entity_ref.entity_type) {
        Some(t) => t,
        None => {
            tracing::warn!("property operations not supported for this entity type");
            return Err(PermissionError::UnsupportedEntityType);
        }
    };

    let parsed_user_id = MacroUserIdStr::parse_from_str(user_id);
    let user_id_ref = parsed_user_id.as_ref().ok().map(std::ops::Deref::deref);

    let access_level = context
        .entity_access_service
        .get_access_level(user_id_ref, &entity_ref.entity_id, model_entity_type)
        .await
        .map_err(|e| {
            tracing::error!(
                error = %e,
                "failed to get user access level"
            );
            PermissionError::InternalError(e.to_string())
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
