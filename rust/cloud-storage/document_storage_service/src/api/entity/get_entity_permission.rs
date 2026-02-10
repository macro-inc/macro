use crate::api::context::EntityAccessService;
use axum::{Json, http::StatusCode, response::IntoResponse};
use entity_access::{
    domain::models::EntityPermission,
    inbound::axum_extractors::{EntityPermissionExtractor, ExtractorError},
};
use serde::Serialize;
use utoipa::ToSchema;

/// API response envelope for entity permissions.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum EntityPermissionResponse {
    Access { permission: EntityPermission },
    NoAccess,
}

/// Get the current user's permission for a given entity.
#[utoipa::path(
    get,
    path = "/entity/{entity_type}/{entity_id}/permissions",
    operation_id = "get_entity_permission",
    params(
        ("entity_type" = String, Path, description = "Entity type (document, chat, project, thread, email_thread, channel)"),
        ("entity_id" = String, Path, description = "Entity ID"),
    ),
    responses(
        (status = 200, body = EntityPermissionResponse),
        (status = 400, description = "Bad request"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Entity not found"),
    )
)]
pub async fn handler(
    result: Result<EntityPermissionExtractor<EntityAccessService>, ExtractorError>,
) -> impl IntoResponse {
    match result {
        Ok(ext) => (
            StatusCode::OK,
            Json(EntityPermissionResponse::Access {
                permission: ext.permission,
            }),
        )
            .into_response(),
        Err(ExtractorError::Unauthorized | ExtractorError::UnauthorizedWithMessage(_)) => {
            (StatusCode::OK, Json(EntityPermissionResponse::NoAccess)).into_response()
        }
        Err(e) => e.into_response(),
    }
}
