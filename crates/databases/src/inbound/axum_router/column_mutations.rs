use super::*;
use crate::domain::models::{ChangeColumnType, ColumnSchemaOutcome};

/// Explicit column type configuration. Existing values must convert without loss.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeColumnTypeRequest {
    /// Requested property type.
    pub data_type: DataType,
    /// Whether select, link or entity values may hold multiple items.
    #[serde(default)]
    pub is_multi_select: bool,
    /// Required category for entity references, omitted for row relationships.
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Related table, when choosing a database-row relationship.
    pub link_to_table_id: Option<Uuid>,
    /// Related database; defaults to the current database.
    pub link_to_database_id: Option<Uuid>,
    /// Table version shown when the type menu opened.
    pub base_version: TableVersion,
}

/// Guard a column deletion against concurrent writes.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteColumnRequest {
    /// Table version shown in the confirmation.
    pub base_version: TableVersion,
}

/// A complete placement order, identified by stable column IDs.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderColumnsRequest {
    /// Every column, exactly once.
    pub column_ids: Vec<Uuid>,
    /// Table version used to build the order.
    pub base_version: TableVersion,
}

/// Change one column's type with all-or-nothing conversion.
#[utoipa::path(patch, tag = "databases", operation_id = "change_database_column_type",
    path = "/databases/{id}/tables/{table_id}/columns/{column_id}/type",
    params(("id" = Uuid, Path), ("table_id" = Uuid, Path), ("column_id" = Uuid, Path)),
    request_body = ChangeColumnTypeRequest,
    responses((status = 200, body = ColumnSchemaOutcome), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn change_column_type_handler<S, Eas, Auth>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<DatabasesRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<ColumnOptionsPath>,
    Json(req): Json<ChangeColumnTypeRequest>,
) -> Result<Json<ColumnSchemaOutcome>, DatabaseError>
where
    S: DatabasesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .change_column_type(
            access.entity_access_receipt,
            viewer_of(&user),
            ChangeColumnType {
                table_id: path.table_id,
                column_id: path.column_id,
                data_type: req.data_type,
                is_multi_select: req.is_multi_select,
                specific_entity_type: req.specific_entity_type,
                relation: req
                    .link_to_table_id
                    .map(|table_id| (req.link_to_database_id.unwrap_or(path.id), table_id)),
                base_version: req.base_version,
            },
        )
        .await
        .map(Json)
}

/// Delete one placement and its cells, preserving shared definitions.
#[utoipa::path(delete, tag = "databases", operation_id = "delete_database_column",
    path = "/databases/{id}/tables/{table_id}/columns/{column_id}",
    params(("id" = Uuid, Path), ("table_id" = Uuid, Path), ("column_id" = Uuid, Path)),
    request_body = DeleteColumnRequest,
    responses((status = 200, body = ColumnSchemaOutcome), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn delete_column_handler<S, Eas, Auth>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<DatabasesRouterState<S, Eas, Auth>>,
    Path(path): Path<ColumnOptionsPath>,
    Json(req): Json<DeleteColumnRequest>,
) -> Result<Json<ColumnSchemaOutcome>, DatabaseError>
where
    S: DatabasesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete_column(
            access.entity_access_receipt,
            path.table_id,
            path.column_id,
            req.base_version,
        )
        .await
        .map(Json)
}

/// Persist the order of every column in a table.
#[utoipa::path(patch, tag = "databases", operation_id = "reorder_database_columns",
    path = "/databases/{id}/tables/{table_id}/columns/order",
    params(("id" = Uuid, Path), ("table_id" = Uuid, Path)), request_body = ReorderColumnsRequest,
    responses((status = 200, body = ColumnSchemaOutcome), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn reorder_columns_handler<S, Eas, Auth>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, Eas, Auth>,
    State(state): State<DatabasesRouterState<S, Eas, Auth>>,
    Path(path): Path<ColumnPath>,
    Json(req): Json<ReorderColumnsRequest>,
) -> Result<Json<ColumnSchemaOutcome>, DatabaseError>
where
    S: DatabasesService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .reorder_columns(
            access.entity_access_receipt,
            path.table_id,
            req.column_ids,
            req.base_version,
        )
        .await
        .map(Json)
}
