use crate::domain::journal::{RowHistoryEntry, TableChanges, UndoOutcome};
use crate::domain::models::{ChangeId, RowId};

use super::*;

/// A row's history.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RowHistoryResponse {
    /// Every committed change that touched the row, newest first: who made
    /// it, when, how, and the touched columns' values before and after.
    pub changes: Vec<RowHistoryEntry>,
}

/// Path params for a row's routes.
#[derive(Debug, Deserialize)]
pub struct RowPath {
    /// Database id.
    pub id: DatabaseId,
    /// Table id.
    pub table_id: TableId,
    /// Row id.
    pub row_id: RowId,
}

/// A row's history, from the change journal: every committed change that
/// touched it, newest first, with who made it, when, and the values of the
/// columns it touched before and after. It reads after the row is removed,
/// so a removed row's last values stay readable.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "get_database_row_history",
    path = "/databases/{id}/tables/{table_id}/rows/{row_id}/history",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("table_id" = Uuid, Path, description = "Table id"),
        ("row_id" = Uuid, Path, description = "Row id"),
    ),
    responses(
        (status = 200, body = RowHistoryResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn row_history_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<RowPath>,
) -> Result<Json<RowHistoryResponse>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let changes = state
        .service
        .row_history(access.entity_access_receipt, path.table_id, path.row_id)
        .await?;
    Ok(Json(RowHistoryResponse { changes }))
}

/// What undoing a change did.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UndoChangeResponse {
    /// The outcome: reverted, partly reverted with the cells others changed
    /// since left alone, or refused with why and whose change stands in the
    /// way.
    pub outcome: UndoOutcome,
}

/// Path params for a change's routes.
#[derive(Debug, Deserialize)]
pub struct ChangePath {
    /// Database id.
    pub id: DatabaseId,
    /// The change's id in the journal, from an ops response.
    pub change: i64,
}

/// Undo one of your own committed changes: its inverse applies as a new,
/// journaled batch, under the table's lock, guarded against what others
/// changed since. A cell someone changed since is left alone and listed; a
/// row or column you added that someone else wrote since, or a name, option,
/// order, view or card place changed since, refuses the undo. Others'
/// changes always stay. Redo by undoing the undo's change.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "undo_database_change",
    path = "/databases/{id}/changes/{change}/undo",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("change" = i64, Path, description = "The change's journal id"),
    ),
    responses(
        (status = 200, body = UndoChangeResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, description = "No such change in this database", body = ErrorResponse),
        (status = 409, description = "The table kept moving under the undo", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn undo_change_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Path(path): Path<ChangePath>,
) -> Result<Json<UndoChangeResponse>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let outcome = state
        .service
        .undo_change(
            access.entity_access_receipt,
            viewer_of(&user),
            ChangeId(path.change),
        )
        .await?;
    Ok(Json(UndoChangeResponse { outcome }))
}

/// Path params for a table's routes.
#[derive(Debug, Deserialize)]
pub struct TablePath {
    /// Database id.
    pub id: DatabaseId,
    /// Table id.
    pub table_id: TableId,
}

/// The version a reader holds a table at.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ChangesSince {
    /// The table version the reader last read.
    pub since: i64,
}

/// What changed in a table since a version, from the change journal: the
/// rows that changed, each once as it stands now (`insert`, `update` or
/// `delete`), and the columns. A reader holding the table at `since` reads
/// just those rows; it reads the table whole when a column changed, the
/// journal is not `complete`, or the rows are `truncated`.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "get_database_table_changes",
    path = "/databases/{id}/tables/{table_id}/changes",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("table_id" = Uuid, Path, description = "Table id"),
        ChangesSince,
    ),
    responses(
        (status = 200, body = TableChanges),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn table_changes_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<TablePath>,
    axum::extract::Query(query): axum::extract::Query<ChangesSince>,
) -> Result<Json<TableChanges>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let changes = state
        .service
        .table_changes(
            access.entity_access_receipt,
            path.table_id,
            TableVersion(query.since),
        )
        .await?;
    Ok(Json(changes))
}
