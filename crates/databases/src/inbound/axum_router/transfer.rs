//! Table import transport. Parsing and previewing CSV uses Papa Parse in the client.

use super::*;
use crate::domain::transfer::{DatabaseTransferService, ImportTable};

/// Import a new table and every row atomically; retries carry the same request ID.
#[utoipa::path(post, tag = "databases", operation_id = "import_database_table",
    path = "/databases/{id}/import", params(("id" = Uuid, Path)), request_body = ImportTable,
    responses((status = 200, body = Table), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn import_table_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<ImportTable>,
) -> Result<Json<Table>, DatabaseError>
where
    Service: DatabasesService + DatabaseTransferService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .import_table(access.entity_access_receipt, viewer_of(&user), request)
        .await
        .map(Json)
}
