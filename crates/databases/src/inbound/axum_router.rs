//! Axum router for the databases endpoints: typed reads and batched ops,
//! the one write surface of a database's schema and data; SQL runs in the
//! browser engine or the `databases_sql` tools.

/// What a column's values would do under each type (`GET …/casts`), and
/// what they become under one (`POST …/conversion`).
pub mod casts;
/// The change journal: a row's history
/// (`GET /{id}/tables/{table_id}/rows/{row_id}/history`) and undoing a change
/// (`POST /{id}/changes/{change}/undo`).
pub mod history;
/// Typed, batched writes, schema and data: `POST /{id}/ops`.
pub mod ops;
/// Saved, immutable queries that document nodes point at.
pub mod saved_queries;
/// Native database recipient sharing.
pub mod sharing;
#[cfg(test)]
mod test;
/// Atomic table imports.
pub mod transfer;
/// A board's card places: `GET /{id}/views/{view_id}/positions`.
pub mod views;
use crate::domain::sharing::DatabaseSharingService;
use crate::domain::transfer::DatabaseTransferService;
use casts::{column_casts_handler, column_conversion_handler};
use models_databases::{DatabaseId, TableId};
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, put},
};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DatabaseAccessLevelExtractor;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use models_properties::shared::DataType;
use serde::{Deserialize, Serialize};

use crate::domain::models::{
    Awareness, ColumnId, CreateDatabase, Database, DatabaseDetail, DatabaseError, InferColumnType,
    InferColumnTypeOutcome, ListedDatabase, SavedQueryError, Table, TableVersion, Viewer,
};
use crate::domain::ports::DatabasesService;
use crate::domain::templates::{DatabaseTemplate, TEMPLATES, TemplateId};
use ops::OpRefusalResponse;

/// Largest table import accepted, in bytes.
const MAX_IMPORT_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Router state for databases endpoints.
pub struct DatabasesRouterState<Service, EntityAccess, Authorization> {
    service: Arc<Service>,
    entity_access_service: Arc<EntityAccess>,
    authorization_state: MacroAuthorizationState<Authorization>,
}

impl<Service, EntityAccess, Authorization> Clone
    for DatabasesRouterState<Service, EntityAccess, Authorization>
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
    DatabasesRouterState<Service, EntityAccess, Authorization>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
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
    FromRef<DatabasesRouterState<Service, EntityAccess, Authorization>> for Arc<EntityAccess>
{
    fn from_ref(state: &DatabasesRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<DatabasesRouterState<Service, EntityAccess, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &DatabasesRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the databases router.
pub fn databases_router<Service, EntityAccess, Authorization, RouterState>(
    state: DatabasesRouterState<Service, EntityAccess, Authorization>,
) -> Router<RouterState>
where
    Service: DatabasesService + DatabaseSharingService + DatabaseTransferService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_databases_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/import",
            post(transfer::import_table_handler::<Service, EntityAccess, Authorization>)
                .layer(axum::extract::DefaultBodyLimit::max(MAX_IMPORT_BODY_BYTES)),
        )
        .route(
            "/",
            post(create_database_handler::<Service, EntityAccess, Authorization>),
        )
        // Static segments win over `/{id}`, so these never read as a database.
        .route("/templates", get(list_templates_handler::<Authorization>))
        .route(
            "/queries",
            post(saved_queries::save_query_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/queries/{query_id}",
            get(saved_queries::get_query_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}",
            get(get_database_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/awareness",
            put(awareness_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/ops",
            post(ops::apply_ops_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/changes/{change}/undo",
            post(history::undo_change_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tables/{table_id}/changes",
            get(history::table_changes_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tables/{table_id}/rows/{row_id}/history",
            get(history::row_history_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/views/{view_id}/positions",
            get(views::view_positions_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/permissions",
            get(sharing::get_permissions_handler::<Service, EntityAccess, Authorization>)
                .patch(sharing::update_permissions_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tables/{table_id}/columns/{column_id}/casts",
            get(column_casts_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tables/{table_id}/columns/{column_id}/conversion",
            post(column_conversion_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/tables/{table_id}/columns/{column_id}/infer-type",
            post(infer_column_type_handler::<Service, EntityAccess, Authorization>),
        )
        .with_state(state)
}

pub(crate) fn viewer_of<Authorization>(
    user: &MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Viewer {
    Viewer {
        user_id: user.authorization.user.macro_user_id.clone(),
        acting_bot: None,
    }
}

/// Request body for creating a database.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseRequest {
    /// Display name.
    pub name: String,
    /// The template that builds the database; left out, it starts blank.
    #[serde(default)]
    #[schema(nullable = false)]
    pub template: Option<TemplateId>,
}

/// Path params for the column routes.
#[derive(Debug, Deserialize)]
pub struct ColumnPath {
    /// Database id.
    pub id: DatabaseId,
    /// Table id.
    pub table_id: TableId,
    /// Column id.
    pub column_id: ColumnId,
}

/// List the caller's databases.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "list_databases",
    path = "/databases",
    responses(
        (status = 200, body = Vec<ListedDatabase>),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_databases_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Result<Json<Vec<ListedDatabase>>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let databases = state.service.list_databases(viewer_of(&user)).await?;
    Ok(Json(databases))
}

/// Create a database owned by the caller. Blank, its first table, "Table 1",
/// holds a "Name" text column; from a template, the template's tables,
/// columns, views and sample rows build it, all or nothing.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "create_database",
    path = "/databases",
    request_body = CreateDatabaseRequest,
    responses(
        (status = 201, body = Database),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_database_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<CreateDatabaseRequest>,
) -> Result<(StatusCode, Json<Database>), DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let database = state
        .service
        .create_database(CreateDatabase {
            name: request.name,
            owner_id: viewer_of(&user).user_id,
            acting_bot: None,
            template: request.template,
        })
        .await?;
    Ok((StatusCode::CREATED, Json(database)))
}

/// The templates a database can be created from, in the order a picker
/// lists them.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "list_database_templates",
    path = "/databases/templates",
    responses(
        (status = 200, body = Vec<DatabaseTemplate>),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn list_templates_handler<Authorization>(
    _user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
) -> Json<&'static [DatabaseTemplate]>
where
    Authorization: MacroAuthorizationService,
{
    Json(&TEMPLATES)
}

/// Schema detail of one database.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "get_database",
    path = "/databases/{id}",
    params(("id" = Uuid, Path, description = "Database id")),
    responses(
        (status = 200, body = DatabaseDetail),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the database", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_database_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<DatabaseDetail>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let detail = state
        .service
        .get_database(access.entity_access_receipt)
        .await?;
    Ok(Json(detail))
}

/// Tell a database's other viewers where the caller is.
#[utoipa::path(
    put,
    tag = "databases",
    operation_id = "share_database_awareness",
    path = "/databases/{id}/awareness",
    params(("id" = Uuid, Path, description = "Database id")),
    request_body = Awareness,
    responses(
        (status = 204, description = "Relayed to the database's other viewers"),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No access to the database", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn awareness_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(awareness): Json<Awareness>,
) -> Result<StatusCode, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .share_awareness(access.entity_access_receipt, viewer_of(&user), awareness)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Request to settle an empty column's first-value type.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InferColumnTypeRequest {
    /// First-value type: STRING, NUMBER, or ENTITY.
    pub data_type: DataType,
    /// Required entity category for ENTITY.
    #[serde(default)]
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Table version used when interpreting the first value.
    pub base_version: TableVersion,
}

/// Settle a new empty text column's type.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "infer_database_column_type",
    path = "/databases/{id}/tables/{table_id}/columns/{column_id}/infer-type",
    params(("id" = Uuid, Path, description = "Database id"),
           ("table_id" = Uuid, Path, description = "Table id"),
           ("column_id" = Uuid, Path, description = "Column id")),
    request_body = InferColumnTypeRequest,
    responses((status = 200, body = InferColumnTypeOutcome),
              (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse),
              (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse),
              (status = 409, body = ErrorResponse),
              (status = 500, body = ErrorResponse))
)]
#[tracing::instrument(err, skip_all)]
pub async fn infer_column_type_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    Path(ColumnPath {
        table_id,
        column_id,
        ..
    }): Path<ColumnPath>,
    Json(request): Json<InferColumnTypeRequest>,
) -> Result<Json<InferColumnTypeOutcome>, DatabaseError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .infer_column_type(
            access.entity_access_receipt,
            InferColumnType {
                table_id,
                column_id,
                data_type: request.data_type,
                specific_entity_type: request.specific_entity_type,
                base_version: request.base_version,
            },
        )
        .await
        .map(Json)
}

impl IntoResponse for DatabaseError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            DatabaseError::NotFound => StatusCode::NOT_FOUND,
            DatabaseError::Unauthorized => StatusCode::FORBIDDEN,
            DatabaseError::VersionConflict
            | DatabaseError::OptionInUse
            | DatabaseError::RowInUse => StatusCode::CONFLICT,
            DatabaseError::InvalidSchemaOperation(_)
            | DatabaseError::InvalidSharing(_)
            | DatabaseError::InvalidOp(_) => StatusCode::BAD_REQUEST,
            DatabaseError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match self {
            DatabaseError::InvalidOp(refusal) => {
                return (status, Json(OpRefusalResponse::from(refusal))).into_response();
            }
            DatabaseError::InvalidSchemaOperation(reason) => reason.to_string(),
            DatabaseError::Repo(_) => {
                tracing::error!(error = ?self, "databases internal server error");
                "internal server error".to_string()
            }
            other => other.to_string(),
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

impl IntoResponse for SavedQueryError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            SavedQueryError::NotFound => StatusCode::NOT_FOUND,
            SavedQueryError::TooLong => StatusCode::UNPROCESSABLE_ENTITY,
            SavedQueryError::Repo(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            SavedQueryError::Repo(_) => {
                tracing::error!(error = ?self, "saved query repository error");
                "internal server error".to_string()
            }
            other => other.to_string(),
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
