//! Transport for the native database sharing dialog.

use super::*;
use crate::domain::sharing::{DatabaseSharePermissions, DatabaseSharingService};
use entity_access::domain::models::OwnerAccessLevel;
use models_permissions::share_permission::channel_share_permission::UpdateChannelSharePermission;

/// Explicit recipient updates; ownership cannot be changed here.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDatabasePermissionsRequest {
    /// Channel and direct-message grants to change.
    pub channel_share_permissions: Vec<UpdateChannelSharePermission>,
}

/// Read recipients for a database owned by the caller.
#[utoipa::path(get, tag = "databases", operation_id = "get_database_permissions",
    path = "/databases/{id}/permissions", params(("id" = Uuid, Path)),
    responses((status = 200, body = DatabaseSharePermissions), (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn get_permissions_handler<S, Eas, Auth>(
    access: DatabaseAccessLevelExtractor<OwnerAccessLevel, Eas, Auth>,
    State(state): State<DatabasesRouterState<S, Eas, Auth>>,
) -> Result<Json<DatabaseSharePermissions>, DatabaseError>
where
    S: DatabasesService + DatabaseSharingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .share_permissions(access.entity_access_receipt)
        .await
        .map(Json)
}

/// Update recipients after proving database ownership.
#[utoipa::path(patch, tag = "databases", operation_id = "update_database_permissions",
    path = "/databases/{id}/permissions", params(("id" = Uuid, Path)),
    request_body = UpdateDatabasePermissionsRequest,
    responses((status = 200, body = DatabaseSharePermissions), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn update_permissions_handler<S, Eas, Auth>(
    access: DatabaseAccessLevelExtractor<OwnerAccessLevel, Eas, Auth>,
    State(state): State<DatabasesRouterState<S, Eas, Auth>>,
    Json(request): Json<UpdateDatabasePermissionsRequest>,
) -> Result<Json<DatabaseSharePermissions>, DatabaseError>
where
    S: DatabasesService + DatabaseSharingService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .update_share_permissions(
            access.entity_access_receipt,
            request.channel_share_permissions,
        )
        .await
        .map(Json)
}
