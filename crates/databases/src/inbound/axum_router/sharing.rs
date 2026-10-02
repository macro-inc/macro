//! Transport for the native database sharing dialog.

use super::*;
use crate::domain::sharing::DatabaseSharingService;
use entity_access::domain::models::OwnerAccessLevel;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};

/// Read recipients for a database owned by the caller. Link and team
/// sharing are always `null`: databases do not support them yet.
#[utoipa::path(get, tag = "databases", operation_id = "get_database_permissions",
    path = "/databases/{id}/permissions", params(("id" = Uuid, Path)),
    responses((status = 200, body = SharePermissionV2), (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn get_permissions_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<OwnerAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<SharePermissionV2>, DatabaseError>
where
    Service: DatabasesService + DatabaseSharingService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .share_permissions(access.entity_access_receipt)
        .await
        .map(Json)
}

/// Update channel recipients after proving database ownership. Turning on
/// link or team sharing is refused; ownership cannot be changed here.
#[utoipa::path(patch, tag = "databases", operation_id = "update_database_permissions",
    path = "/databases/{id}/permissions", params(("id" = Uuid, Path)),
    request_body = UpdateSharePermissionRequestV2,
    responses((status = 200, body = SharePermissionV2), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn update_permissions_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<OwnerAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Json(request): Json<UpdateSharePermissionRequestV2>,
) -> Result<Json<SharePermissionV2>, DatabaseError>
where
    Service: DatabasesService + DatabaseSharingService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .update_share_permissions(access.entity_access_receipt, request)
        .await
        .map(Json)
}
