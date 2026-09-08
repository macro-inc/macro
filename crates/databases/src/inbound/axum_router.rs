//! Axum router for the databases endpoints.
//!
//! The surface is deliberately tiny and SQL-first:
//!
//! - `POST /exec` — run SQL (reads and writes) as the caller; the viewer's
//!   catalog is the authorization boundary, enforced in the domain service.
//! - `GET /{id}/sqlite` — download a database as a SQLite file (takeout).
//! - `POST /` — create a database; `POST /{id}/tables`,
//!   `POST /{id}/tables/{table_id}/columns` — schema operations, which stay
//!   structured because property definitions carry configuration DDL cannot
//!   express.
//!
//! Handlers are thin: extract identity/receipts, convert DTOs, call the
//! service, map errors. No policy, no persistence.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::models::{
    CreateDatabase, DatabaseError, ExecOutcome, ExecRequest, QueryError, TableVersion, Viewer,
};
use crate::domain::ports::DatabasesService;

/// Router state for databases endpoints.
pub struct DatabasesRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for DatabasesRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> DatabasesRouterState<S, Auth>
where
    S: DatabasesService,
{
    /// Create router state from the service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<DatabasesRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DatabasesRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the databases router.
pub fn databases_router<S, Auth, T>(state: DatabasesRouterState<S, Auth>) -> Router<T>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_database_handler::<S, Auth>))
        .route("/exec", post(exec_handler::<S, Auth>))
        .route("/{id}/sqlite", get(sqlite_snapshot_handler::<S, Auth>))
        .route("/{id}/tables", post(create_table_handler::<S, Auth>))
        .route(
            "/{id}/tables/{table_id}/columns",
            post(create_column_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Request body for creating a database.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseRequest {
    /// Display name.
    pub name: String,
}

/// Request body for `POST /exec`.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecRequestBody {
    /// The statements to run, executed in one transaction.
    pub sql: String,
    /// Optional compare-and-swap: reject writes if any listed table has moved
    /// past the given version. Omitted → cell-level last-write-wins.
    #[schema(nullable = false)]
    pub base_versions: Option<HashMap<Uuid, i64>>,
}

/// Create a database owned by the caller.
pub async fn create_database_handler<S, Auth>(
    State(state): State<DatabasesRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateDatabaseRequest>,
) -> Result<(StatusCode, Json<crate::domain::models::Database>), DatabaseError>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
{
    let owner_id = user.authorization.user.macro_user_id.clone();
    let database = state
        .service
        .create_database(CreateDatabase {
            name: req.name,
            owner_id,
        })
        .await?;
    Ok((StatusCode::CREATED, Json(database)))
}

/// Execute SQL as the caller. The whole read/write surface.
pub async fn exec_handler<S, Auth>(
    State(state): State<DatabasesRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<ExecRequestBody>,
) -> Result<Json<ExecOutcome>, QueryError>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
{
    let viewer = Viewer {
        user_id: user.authorization.user.macro_user_id.clone(),
    };
    let outcome = state
        .service
        .exec_sql(
            viewer,
            ExecRequest {
                sql: req.sql,
                base_versions: req.base_versions.map(|versions| {
                    versions
                        .into_iter()
                        .map(|(table, version)| (table, TableVersion(version)))
                        .collect()
                }),
            },
        )
        .await?;
    Ok(Json(outcome))
}

/// Download a database as a SQLite file.
pub async fn sqlite_snapshot_handler<S, Auth>(
    State(_state): State<DatabasesRouterState<S, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<impl IntoResponse, QueryError>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
{
    // TODO: mint an EntityAccessReceipt<ViewAccessLevel> for the database via
    // a DatabaseAccessExtractor (blocked on EntityType::Database landing in
    // model-entity + entity_access), then call service.sqlite_snapshot and
    // stream the bytes as application/vnd.sqlite3.
    todo!("snapshot handler blocked on EntityType::Database receipt extractor");
    #[allow(unreachable_code)]
    Ok(StatusCode::NOT_IMPLEMENTED)
}

/// Create a table in a database.
pub async fn create_table_handler<S, Auth>(
    State(_state): State<DatabasesRouterState<S, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<StatusCode, DatabaseError>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
{
    // TODO: EntityAccessReceipt<EditAccessLevel> via DatabaseAccessExtractor,
    // then service.create_table.
    todo!("create_table handler blocked on EntityType::Database receipt extractor")
}

/// Add a column to a table.
pub async fn create_column_handler<S, Auth>(
    State(_state): State<DatabasesRouterState<S, Auth>>,
    _user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<StatusCode, DatabaseError>
where
    S: DatabasesService,
    Auth: MacroAuthorizationService,
{
    // TODO: EntityAccessReceipt<EditAccessLevel> via DatabaseAccessExtractor,
    // then service.create_column (binding + link/lookup config DTOs).
    todo!("create_column handler blocked on EntityType::Database receipt extractor")
}

impl IntoResponse for DatabaseError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            DatabaseError::NotFound => StatusCode::NOT_FOUND,
            DatabaseError::Unauthorized => StatusCode::FORBIDDEN,
            DatabaseError::InvalidSchemaOperation(_) => StatusCode::BAD_REQUEST,
            DatabaseError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            DatabaseError::Repo(_) => {
                tracing::error!(error = ?self, "databases internal server error");
                "internal server error".to_string()
            }
            other => other.to_string(),
        };
        (status, message).into_response()
    }
}

impl IntoResponse for QueryError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            // SQLite's message is the product's "broken query" state — pass it
            // through verbatim for chips to render.
            QueryError::Sql(_) | QueryError::UntranslatableChange(_) => StatusCode::BAD_REQUEST,
            QueryError::ReadOnly(_) => StatusCode::FORBIDDEN,
            QueryError::VersionConflict { .. } => StatusCode::CONFLICT,
            QueryError::BudgetExceeded => StatusCode::UNPROCESSABLE_ENTITY,
            QueryError::Infrastructure(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            QueryError::Infrastructure(_) => {
                tracing::error!(error = ?self, "databases query infrastructure error");
                "internal server error".to_string()
            }
            other => other.to_string(),
        };
        (status, message).into_response()
    }
}
