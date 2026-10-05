use super::*;
use crate::domain::models::{ColumnCast, ColumnConversion};

/// What changing one column to each type of the type menu would do to its
/// values: safe, checked (with how many values would not convert and a few
/// of them), or never (with why). Changes nothing.
#[utoipa::path(get, tag = "databases", operation_id = "list_database_column_casts",
    path = "/databases/{id}/tables/{table_id}/columns/{column_id}/casts",
    params(("id" = Uuid, Path), ("table_id" = Uuid, Path), ("column_id" = Uuid, Path)),
    responses((status = 200, body = Vec<ColumnCast>),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn column_casts_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<ColumnPath>,
) -> Result<Json<Vec<ColumnCast>>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .column_casts(access.entity_access_receipt, path.table_id, path.column_id)
        .await
        .map(Json)
}

/// The type a column's values are converted to.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ColumnConversionRequest {
    /// The type of the column the values would go to.
    pub to: models_databases::ColumnKind,
}

/// What one column's values become under another type: the values that
/// convert, with the options they need, for a new column of that type beside
/// it. The column itself is left as it is: a client writes the conversion as
/// one ops batch, a `create_column` then an `update_rows`, with the answered
/// table version as its base version. Changes nothing.
#[utoipa::path(post, tag = "databases", operation_id = "convert_database_column",
    path = "/databases/{id}/tables/{table_id}/columns/{column_id}/conversion",
    params(("id" = Uuid, Path), ("table_id" = Uuid, Path), ("column_id" = Uuid, Path)),
    request_body = ColumnConversionRequest,
    responses((status = 200, body = ColumnConversion),
        (status = 400, description = "No value of the column converts to the type", body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn column_conversion_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<ColumnPath>,
    Json(request): Json<ColumnConversionRequest>,
) -> Result<Json<ColumnConversion>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .column_conversion(
            access.entity_access_receipt,
            path.table_id,
            path.column_id,
            request.to,
        )
        .await
        .map(Json)
}
