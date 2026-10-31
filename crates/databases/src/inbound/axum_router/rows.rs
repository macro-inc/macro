use crate::domain::ports::DatabaseRowPages;
use crate::domain::storage::{StorageRows, StorageRowsQuery};

use super::history::TablePath;
use super::*;

/// A page of a table's rows, filtered and sorted by `query`, with the table
/// version every row of it was read at. Pass `next` as `after` for the next
/// page; a page at another version, or a 409, means the table changed, so
/// read again from the first page. Changes nothing.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "query_database_table_rows",
    path = "/databases/{id}/tables/{table_id}/rows",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("table_id" = Uuid, Path, description = "Table id"),
    ),
    request_body = StorageRowsQuery,
    responses(
        (status = 200, body = StorageRows),
        (status = 400, description = "The query does not apply to the table", body = OpRefusalResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, description = "The table changed during the read, or no longer holds `after`", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn table_rows_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<TablePath>,
    Json(query): Json<StorageRowsQuery>,
) -> Result<Json<StorageRows>, DatabaseError>
where
    Service: DatabaseRowPages,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .row_page(access.entity_access_receipt, path.table_id, query)
        .await
        .map(Json)
}
