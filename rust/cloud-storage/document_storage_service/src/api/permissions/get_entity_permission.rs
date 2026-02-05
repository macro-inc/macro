use axum::{Json, http::StatusCode, response::IntoResponse};
use macro_middleware::cloud_storage::ensure_access::entity_permission::EntityPermissionExtractor;

pub async fn handler(
    EntityPermissionExtractor(permission): EntityPermissionExtractor,
) -> impl IntoResponse {
    (StatusCode::OK, Json(permission))
}
