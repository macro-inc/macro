//! Axum router for synced tables, nested at `/databases`. Managing a
//! database's syncs takes edit access to it; listing sources and creating a
//! synced database take a signed-in user.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DatabaseAccessLevelExtractor;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::Serialize;
use utoipa::OpenApi;
use uuid::Uuid;

use crate::domain::models::{
    AvailableSources, DatabaseSync, DatabaseSyncError, DetachReason, DetachedColumn,
    GranolaAvailability, GranolaField, NewSync, NotionAvailability, NotionDataSourceSummary,
    SyncFailure, SyncField, SyncId, SyncSource, SyncStatus, SyncedColumn,
};
use crate::domain::ports::DatabaseSyncsService;

/// Router state for the syncs endpoints.
pub struct DatabaseSyncsRouterState<Service, EntityAccess, Authorization> {
    service: Arc<Service>,
    entity_access_service: Arc<EntityAccess>,
    authorization_state: MacroAuthorizationState<Authorization>,
}

impl<Service, EntityAccess, Authorization> Clone
    for DatabaseSyncsRouterState<Service, EntityAccess, Authorization>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Service, EntityAccess, Authorization>
    DatabaseSyncsRouterState<Service, EntityAccess, Authorization>
{
    /// Router state from the syncs service, entity access and authorization.
    pub fn new(
        service: Arc<Service>,
        entity_access_service: Arc<EntityAccess>,
        authorization_state: MacroAuthorizationState<Authorization>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>> for Arc<EntityAccess>
{
    fn from_ref(state: &DatabaseSyncsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &DatabaseSyncsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the syncs router, to nest at `/databases`.
pub fn database_syncs_router<Service, EntityAccess, Authorization, RouterState>(
    state: DatabaseSyncsRouterState<Service, EntityAccess, Authorization>,
) -> Router<RouterState>
where
    Service: DatabaseSyncsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        // Static segments win over `/{id}`, so these never read as a database.
        .route(
            "/syncs/sources",
            get(sources_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/syncs",
            post(create_synced_database_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/syncs",
            post(create_sync_handler::<Service, EntityAccess, Authorization>)
                .get(list_syncs_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/syncs/{sync_id}/run",
            post(sync_now_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/syncs/{sync_id}",
            delete(delete_sync_handler::<Service, EntityAccess, Authorization>),
        )
        .with_state(state)
}

/// A database's syncs.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabaseSyncsResponse {
    /// Oldest first.
    pub syncs: Vec<DatabaseSync>,
}

impl IntoResponse for DatabaseSyncError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            DatabaseSyncError::Database(error) => return error.into_response(),
            DatabaseSyncError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            DatabaseSyncError::Forbidden(reason) => (StatusCode::FORBIDDEN, reason.to_string()),
            DatabaseSyncError::IdTaken => (
                StatusCode::CONFLICT,
                "the id names another sync".to_string(),
            ),
            DatabaseSyncError::SourceDisconnected => {
                (StatusCode::CONFLICT, "connect the source first".to_string())
            }
            DatabaseSyncError::SourceNotFound => (
                StatusCode::NOT_FOUND,
                "the source was not found, or the connection may not read it".to_string(),
            ),
            DatabaseSyncError::SourceUnavailable(ref report) => {
                tracing::warn!(error = ?report, "a sync source could not be read");
                (
                    StatusCode::BAD_GATEWAY,
                    "the source could not be read; try again".to_string(),
                )
            }
            DatabaseSyncError::Repository(ref report) => {
                tracing::error!(error = ?report, "database syncs internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
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

/// What the caller can sync a table from: whether Granola is connected,
/// and the Notion data sources their connection can read.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "list_database_sync_sources",
    path = "/databases/syncs/sources",
    responses(
        (status = 200, body = AvailableSources),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 502, description = "Notion could not be read", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn sources_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Result<Json<AvailableSources>, DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    Authorization: MacroAuthorizationService,
{
    let sources = state
        .service
        .sources(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(sources))
}

/// Create a database, named after the source, whose one table is synced
/// with it. Retrying with the same `id` answers the first attempt's sync.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "create_synced_database",
    path = "/databases/syncs",
    request_body = NewSync,
    responses(
        (status = 201, body = DatabaseSync),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, description = "The source was not found, or the connection may not read it", body = ErrorResponse),
        (status = 409, description = "The source is not connected, or the id names another sync", body = ErrorResponse),
        (status = 502, description = "The source could not be read", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_synced_database_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<NewSync>,
) -> Result<(StatusCode, Json<DatabaseSync>), DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    Authorization: MacroAuthorizationService,
{
    let sync = state
        .service
        .create_synced_database(&user.authorization.user.macro_user_id, request)
        .await?;
    Ok((StatusCode::CREATED, Json(sync)))
}

/// Add a table synced with a source to the database. Its writes act with
/// the caller's access. Retrying with the same `id` answers the first
/// attempt's sync.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "create_database_sync",
    path = "/databases/{id}/syncs",
    params(("id" = Uuid, Path, description = "Database id")),
    request_body = NewSync,
    responses(
        (status = 201, body = DatabaseSync),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, description = "The source was not found, or the connection may not read it", body = ErrorResponse),
        (status = 409, description = "The source is not connected, or the id names another sync", body = ErrorResponse),
        (status = 502, description = "The source could not be read", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_sync_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
    Json(request): Json<NewSync>,
) -> Result<(StatusCode, Json<DatabaseSync>), DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let sync = state
        .service
        .create_sync(access.entity_access_receipt, request)
        .await?;
    Ok((StatusCode::CREATED, Json(sync)))
}

/// The database's syncs.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "list_database_syncs",
    path = "/databases/{id}/syncs",
    params(("id" = Uuid, Path, description = "Database id")),
    responses(
        (status = 200, body = ListDatabaseSyncsResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_syncs_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<ListDatabaseSyncsResponse>, DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let syncs = state
        .service
        .list_syncs(access.entity_access_receipt)
        .await?;
    Ok(Json(ListDatabaseSyncsResponse { syncs }))
}

/// Run a sync as soon as a worker is free.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "run_database_sync",
    path = "/databases/{id}/syncs/{sync_id}/run",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("sync_id" = Uuid, Path, description = "Sync id"),
    ),
    responses(
        (status = 202),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn sync_now_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<(Uuid, SyncId)>,
) -> Result<StatusCode, DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .sync_now(access.entity_access_receipt, path.1)
        .await?;
    Ok(StatusCode::ACCEPTED)
}

/// Stop a sync. Its table and rows stay as they are.
#[utoipa::path(
    delete,
    tag = "databases",
    operation_id = "delete_database_sync",
    path = "/databases/{id}/syncs/{sync_id}",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("sync_id" = Uuid, Path, description = "Sync id"),
    ),
    responses(
        (status = 204),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_sync_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseSyncsRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<(Uuid, SyncId)>,
) -> Result<StatusCode, DatabaseSyncError>
where
    Service: DatabaseSyncsService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .delete_sync(access.entity_access_receipt, path.1)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The syncs endpoints and their schemas, for the host's OpenAPI document.
#[derive(OpenApi)]
#[openapi(
    paths(
        sources_handler,
        create_synced_database_handler,
        create_sync_handler,
        list_syncs_handler,
        sync_now_handler,
        delete_sync_handler,
    ),
    components(schemas(
        AvailableSources,
        DatabaseSync,
        DetachReason,
        DetachedColumn,
        GranolaAvailability,
        GranolaField,
        ListDatabaseSyncsResponse,
        NewSync,
        NotionAvailability,
        NotionDataSourceSummary,
        SyncFailure,
        SyncField,
        SyncSource,
        SyncStatus,
        SyncedColumn,
    ))
)]
pub struct DatabaseSyncsApi;
