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
    models::{DatabaseId, QueryDefinition, SavedQuery, TableId, TableVersion, Viewer},
    ports::DatabasesService,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use soup::domain::ports::SoupService;

use crate::{ChartColumns, DatabasesSql, SqlError, SqlOutcome, SqlRequest};

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

/// Request body for saving a question.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryRequest {
    /// What the question asks: `{"version": 1, "query": "<SELECT>"}`.
    pub definition: QueryDefinition,
    /// The database whose tables win name resolution. The caller must be
    /// able to see it.
    #[serde(default)]
    #[schema(nullable = false, value_type = Option<Uuid>)]
    pub database_id: Option<DatabaseId>,
    /// The result columns a chart of the answer plots, checked against what
    /// the `SELECT` returns. The chart itself lives with the answer's block.
    #[serde(default)]
    #[schema(nullable = false)]
    pub chart: Option<SaveQueryChart>,
}

/// The result columns a chart of a saved question plots.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryChart {
    /// The label column.
    pub x: String,
    /// The value columns, each a number.
    pub y: Vec<String>,
    /// The column whose values split the series.
    #[serde(default)]
    #[schema(nullable = false)]
    pub color: Option<String>,
}

/// Saved-question failures translated at the HTTP boundary.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct SaveQueryError(#[from] SqlError);

impl IntoResponse for SaveQueryError {
    fn into_response(self) -> Response {
        match self.0 {
            // The stored text has its own limit, below the statement limit.
            SqlError::TooLong => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ErrorResponse {
                    message: SqlError::TooLong.to_string().into(),
                }),
            )
                .into_response(),
            other => QueryError(other).into_response(),
        }
    }
}

/// Save a question: a `SELECT` that compiles against the caller's databases,
/// whose chart columns, when given, are ones it returns. Saved questions
/// never change; editing one saves a new one.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "save_database_query",
    path = "/databases/queries",
    request_body = SaveQueryRequest,
    responses(
        (status = 201, body = SavedQuery),
        (status = 400, description = "Not a SELECT, does not compile, or the chart names a column it does not return", body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, description = "The database is missing or not visible", body = ErrorResponse),
        (status = 422, description = "The query is too long", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "database.save_query", skip_all, fields(database_id = ?request.database_id, charted = request.chart.is_some()), err)]
pub async fn save_query_handler<D, A, S, C, Auth>(
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    State(state): State<SqlRouterState<D, A, S, C, Auth>>,
    Json(request): Json<SaveQueryRequest>,
) -> Result<(StatusCode, Json<SavedQuery>), SaveQueryError>
where
    D: DatabasesService,
    A: EntityAccessService,
    S: SoupService,
    C: ContactsService,
    Auth: MacroAuthorizationService,
{
    let saved = state
        .sql
        .save_query(
            Viewer {
                user_id: user.authorization.user.macro_user_id,
                acting_bot: None,
            },
            request.database_id,
            request.definition,
            request.chart.as_ref().map(|chart| ChartColumns {
                x: &chart.x,
                y: &chart.y,
                color: chart.color.as_deref(),
            }),
        )
        .await?;
    Ok((StatusCode::CREATED, Json(saved)))
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
        .route("/queries", post(save_query_handler::<D, A, S, C, Auth>))
        .with_state(state)
}
