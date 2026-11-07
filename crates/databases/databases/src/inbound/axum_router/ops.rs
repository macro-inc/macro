use std::collections::HashMap;

use models_databases::{DatabaseOp, OpResult, TakenId};

use crate::domain::models::{CommittedChange, OpBatch, OpRefusal};
use serde::Serialize;

use super::*;

/// A batch of ops for one database, applied in order, in one transaction,
/// together or not at all.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOpsRequest {
    /// The ops, in the order they apply, each grouped by the resource it
    /// changes (`table`, `column`, `rows`, `view`, `reorder_tables`) with a
    /// `change` saying how. Every one names a table of this database, or one
    /// an earlier op of the batch creates: tables, columns, options and
    /// views carry ids the client mints (UUIDv7), so a later op can name
    /// them. An id that already names something refuses the batch.
    pub ops: Vec<DatabaseOp>,
    /// The version each named table must still be at, as the caller read
    /// it. A table that moved refuses the batch as a conflict, so a schema
    /// edit made against what the caller saw does not overwrite another's.
    /// Left out, ops are last-write-wins.
    #[serde(default)]
    #[schema(value_type = HashMap<String, TableVersion>)]
    pub base_versions: HashMap<TableId, TableVersion>,
}

/// What each op of a batch did.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOpsResponse {
    /// One result per op, in the order the ops were sent. Each is grouped as
    /// its op is: the same outer `kind`, naming the same ids, with a
    /// `change` saying what happened.
    pub results: Vec<OpResult>,
    /// The journal's change for each table version the batch produced: the
    /// ids `POST /databases/{id}/changes/{change}/undo` takes.
    pub changes: Vec<CommittedChange>,
}

/// Why an op of a batch was refused. Nothing in the batch was written.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpRefusalResponse {
    /// What is wrong.
    pub message: String,
    /// The refused op's index in the request.
    pub op: usize,
    /// The row's index within the op, when one row is at fault.
    #[schema(required = true)]
    pub row: Option<usize>,
    /// The column placement at fault, when one is.
    #[schema(required = true, value_type = Option<Uuid>)]
    pub column: Option<ColumnId>,
    /// The id the op minted that already names something, when that is why
    /// it was refused: a retried request whose first attempt committed, or
    /// an id minted twice.
    #[schema(required = true)]
    pub taken: Option<TakenId>,
}

impl From<OpRefusal> for OpRefusalResponse {
    fn from(refusal: OpRefusal) -> Self {
        Self {
            message: refusal.reason,
            op: refusal.op,
            row: refusal.row,
            column: refusal.column,
            taken: refusal.taken,
        }
    }
}

/// Apply a batch of typed ops, the one write surface of a database: add,
/// rename, remove and order tables and columns, change a column's type, add
/// and change options, insert, update and delete rows, and write views and a
/// board's card places. The ops apply in order in one transaction, so a
/// later op may name a table, column, option or view an earlier one created
/// under the id its client minted. Ops are last-write-wins unless the batch names
/// base versions. A refused op, named by its index (and row and column where
/// relevant), leaves the whole batch unwritten.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "apply_database_ops",
    path = "/databases/{id}/ops",
    params(("id" = Uuid, Path, description = "Database id")),
    request_body = ApplyOpsRequest,
    responses(
        (status = 200, body = ApplyOpsResponse),
        (status = 400, description = "An op was refused; nothing was written", body = OpRefusalResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, description = "A table moved from its base version, or a schema change raced another", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn apply_ops_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<ApplyOpsRequest>,
) -> Result<Json<ApplyOpsResponse>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let applied = state
        .service
        .apply_ops_with_changes(
            access.entity_access_receipt,
            viewer_of(&user),
            OpBatch {
                ops: request.ops,
                base_versions: request.base_versions,
            },
        )
        .await?;
    Ok(Json(ApplyOpsResponse {
        results: applied.results,
        changes: applied.changes,
    }))
}
