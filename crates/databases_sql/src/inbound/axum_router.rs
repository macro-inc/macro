//! Authenticated SQL execution; visibility and write policy stay in `DatabasesSql`.
use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use contacts::domain::ports::ContactsService;
use databases::domain::{
    models::{DatabaseId, TableId, TableVersion, Viewer},
    ports::DatabasesService,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use soup::domain::ports::SoupService;

use crate::{DatabasesSql, SqlError, SqlOutcome, SqlRequest};

/// SQL service and the same principal authentication used by database routes.
pub struct SqlRouterState<Databases, Access, Soup, Contacts, Authorization> {
    sql: DatabasesSql<Databases, Access, Soup, Contacts>,
    authorization: MacroAuthorizationState<Authorization>,
}

impl<D, A, S, C, Auth> Clone for SqlRouterState<D, A, S, C, Auth> {
    fn clone(&self) -> Self {
        Self {
            sql: self.sql.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<D, A, S, C, Auth> SqlRouterState<D, A, S, C, Auth> {
    /// Wire the domain SQL service and authentication at the composition root.
    pub fn new(
        sql: DatabasesSql<D, A, S, C>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self { sql, authorization }
    }
}

impl<D, A, S, C, Auth> FromRef<SqlRouterState<D, A, S, C, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SqlRouterState<D, A, S, C, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// One SQL statement with an optional default database and optimistic write guards.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryRequest {
    /// One supported SQL statement. Writes execute once, without automatic retries.
    pub sql: String,
    /// Default database for resolving unqualified table names; other visible databases remain joinable.
    pub database_id: Option<DatabaseId>,
    /// Expected version for each table a subsequent statement writes.
    #[serde(default)]
    pub base_versions: HashMap<TableId, TableVersion>,
}

/// SQL failures translated at the HTTP boundary.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct QueryError(#[from] SqlError);

impl IntoResponse for QueryError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            SqlError::NotFound => StatusCode::NOT_FOUND,
            SqlError::TableReadOnly { .. } => StatusCode::FORBIDDEN,
            SqlError::VersionConflict { .. } | SqlError::SchemaVersionConflict { .. } => {
                StatusCode::CONFLICT
            }
            SqlError::Compile(_)
            | SqlError::Run(_)
            | SqlError::WriteRefused { .. }
            | SqlError::TooLong
            | SqlError::SavedQueryNotSelect
            | SqlError::ChartColumnNotReturned { .. }
            | SqlError::ChartValueNotNumeric { .. } => StatusCode::BAD_REQUEST,
            SqlError::Infrastructure(_)
            | SqlError::WrittenTableNotInCatalog { .. }
            | SqlError::AlteredColumnNotInCatalog { .. }
            | SqlError::AlterWithoutAlteredColumn => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            "Query failed".to_owned()
        } else {
            self.0.to_string()
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Run one statement as the authenticated user. The viewer's catalog authorizes reads;
/// the SQL domain service obtains an edit receipt for every written database.
#[utoipa::path(post, tag = "databases", operation_id = "query_databases", path = "/databases/query",
    request_body = DatabaseQueryRequest,
    responses((status = 200, body = SqlOutcome), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(name = "database.query", skip_all, fields(database_id = ?request.database_id, statement_bytes = request.sql.len()), err)]
pub async fn query_databases_handler<D, A, S, C, Auth>(
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    State(state): State<SqlRouterState<D, A, S, C, Auth>>,
    Json(request): Json<DatabaseQueryRequest>,
) -> Result<Json<SqlOutcome>, QueryError>
where
    D: DatabasesService,
    A: EntityAccessService,
    S: SoupService,
    C: ContactsService,
    Auth: MacroAuthorizationService,
{
    state
        .sql
        .execute(
            Viewer {
                user_id: user.authorization.user.macro_user_id,
                acting_bot: None,
            },
            SqlRequest {
                sql: request.sql,
                scope: request.database_id,
                base_versions: request.base_versions,
            },
        )
        .await
        .map(Json)
        .map_err(QueryError::from)
}

/// Mount under `/databases`, alongside the schema/ops routes.
pub fn sql_router<D, A, S, C, Auth, RouterState>(
    state: SqlRouterState<D, A, S, C, Auth>,
) -> Router<RouterState>
where
    D: DatabasesService,
    A: EntityAccessService,
    S: SoupService,
    C: ContactsService,
    Auth: MacroAuthorizationService,
    RouterState: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/query", post(query_databases_handler::<D, A, S, C, Auth>))
        .with_state(state)
}
