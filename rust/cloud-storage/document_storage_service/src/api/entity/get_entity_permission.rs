use axum::{Json, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::entity_permission::EntityPermissionExtractor;
use model::response::GenericErrorResponse;
use models_permissions::entity_permission::EntityPermissionResponse;

/// Get the current user's permission for a given entity.
#[utoipa::path(
    get,
    path = "/entity/{entity_type}/{entity_id}/permissions",
    params(
        ("entity_type" = String, Path, description = "Entity type (document, chat, project, thread, email_thread, channel)"),
        ("entity_id" = String, Path, description = "Entity ID"),
    ),
    responses(
        (status = 200, body = EntityPermissionResponse),
        (status = 401, body = GenericErrorResponse),
        (status = 404, body = GenericErrorResponse),
    )
)]
pub async fn handler(
    EntityPermissionExtractor(permission): EntityPermissionExtractor,
) -> impl IntoResponse {
    (StatusCode::OK, Json(permission))
}
