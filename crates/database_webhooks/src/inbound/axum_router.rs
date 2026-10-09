//! Axum router for database webhooks, mounted beside the databases router at
//! `/databases`. Managing a database's webhooks takes edit access to it;
//! calling one takes only its token, which the URL carries.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::DatabaseAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model_error_response::ErrorResponse;
use models_databases::{DatabaseId, RowId, TableId};
use serde::{Deserialize, Serialize};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::domain::models::{
    CreatedWebhook, DatabaseWebhook, DatabaseWebhookError, Delivery, PayloadProblem, WebhookId,
};
use crate::domain::ports::DatabaseWebhooksService;

/// Router state for the webhooks endpoints.
pub struct DatabaseWebhooksRouterState<Service, EntityAccess, Authorization> {
    service: Arc<Service>,
    entity_access_service: Arc<EntityAccess>,
    authorization_state: MacroAuthorizationState<Authorization>,
}

impl<Service, EntityAccess, Authorization> Clone
    for DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>
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
    DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>
{
    /// Router state from the webhooks service, entity access and
    /// authorization.
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
    FromRef<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>
    for Arc<EntityAccess>
{
    fn from_ref(state: &DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the webhooks router, merged into the one mounted at `/databases`.
pub fn database_webhooks_router<Service, EntityAccess, Authorization, RouterState>(
    state: DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>,
) -> Router<RouterState>
where
    Service: DatabaseWebhooksService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    Router::new()
        // Static segments win over `/{id}`, so this never reads as a database.
        .route(
            "/webhooks/{token}",
            post(deliver_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/webhooks",
            post(create_webhook_handler::<Service, EntityAccess, Authorization>)
                .get(list_webhooks_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{id}/webhooks/{webhook_id}",
            delete(delete_webhook_handler::<Service, EntityAccess, Authorization>),
        )
        .with_state(state)
}

/// A webhook of a database. Its token is never shown again after creation.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseWebhookResponse {
    /// Identifier.
    pub id: Uuid,
    /// The database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table its calls insert rows into.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// Who created it; its calls write with their access.
    pub created_by: String,
    /// The token's first characters, to tell webhooks apart.
    pub token_prefix: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

impl From<DatabaseWebhook> for DatabaseWebhookResponse {
    fn from(webhook: DatabaseWebhook) -> Self {
        Self {
            id: webhook.id,
            database_id: webhook.database_id,
            table_id: webhook.table_id,
            created_by: webhook.created_by,
            token_prefix: webhook.token_prefix,
            created_at: webhook.created_at,
        }
    }
}

/// Which table a new webhook inserts rows into.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseWebhookRequest {
    /// A table of the database.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
}

/// A new webhook, with the token its URL carries. The token is shown only
/// here.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDatabaseWebhookResponse {
    /// The webhook.
    pub webhook: DatabaseWebhookResponse,
    /// The secret: `POST /databases/webhooks/{token}` inserts rows.
    pub token: String,
}

impl From<CreatedWebhook> for CreatedDatabaseWebhookResponse {
    fn from(created: CreatedWebhook) -> Self {
        Self {
            webhook: created.webhook.into(),
            token: created.token,
        }
    }
}

/// A database's webhooks.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabaseWebhooksResponse {
    /// Oldest first.
    pub webhooks: Vec<DatabaseWebhookResponse>,
}

/// The rows a webhook call inserted.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseWebhookDeliveryResponse {
    /// The database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// The new rows, in the order the payload sent them.
    #[schema(value_type = Vec<Uuid>)]
    pub rows: Vec<RowId>,
}

impl From<Delivery> for DatabaseWebhookDeliveryResponse {
    fn from(delivery: Delivery) -> Self {
        Self {
            database_id: delivery.database_id,
            table_id: delivery.table_id,
            rows: delivery.rows,
        }
    }
}

/// One thing wrong with a webhook payload.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseWebhookPayloadProblem {
    /// The row's index, when the payload is an array of rows.
    #[schema(required = true)]
    pub row: Option<usize>,
    /// The key at fault, when one is.
    #[schema(required = true)]
    pub field: Option<String>,
    /// What is wrong.
    pub message: String,
}

impl From<PayloadProblem> for DatabaseWebhookPayloadProblem {
    fn from(problem: PayloadProblem) -> Self {
        Self {
            row: problem.row,
            field: problem.field,
            message: problem.message,
        }
    }
}

/// Why a payload was refused. Nothing was written.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvalidDatabaseWebhookPayloadResponse {
    /// A summary.
    pub message: String,
    /// Every problem found.
    pub problems: Vec<DatabaseWebhookPayloadProblem>,
}

impl IntoResponse for DatabaseWebhookError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            DatabaseWebhookError::InvalidPayload(problems) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(InvalidDatabaseWebhookPayloadResponse {
                        message: "the payload does not fit the table; nothing was written"
                            .to_string(),
                        problems: problems.into_iter().map(Into::into).collect(),
                    }),
                )
                    .into_response();
            }
            DatabaseWebhookError::Database(error) => return error.into_response(),
            DatabaseWebhookError::NotFound => (StatusCode::NOT_FOUND, "not found".to_string()),
            DatabaseWebhookError::Forbidden(reason) => (StatusCode::FORBIDDEN, reason.to_string()),
            DatabaseWebhookError::Repository(ref report) => {
                tracing::error!(error = ?report, "database webhooks internal server error");
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

/// Create a webhook: a secret URL whose calls insert rows into one of the
/// database's tables, writing with the creator's access.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "create_database_webhook",
    path = "/databases/{id}/webhooks",
    params(("id" = Uuid, Path, description = "Database id")),
    request_body = CreateDatabaseWebhookRequest,
    responses(
        (status = 201, body = CreatedDatabaseWebhookResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 404, description = "No such table in the database", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_webhook_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>,
    Json(request): Json<CreateDatabaseWebhookRequest>,
) -> Result<(StatusCode, Json<CreatedDatabaseWebhookResponse>), DatabaseWebhookError>
where
    Service: DatabaseWebhooksService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let created = state
        .service
        .create_webhook(access.entity_access_receipt, request.table_id)
        .await?;
    Ok((StatusCode::CREATED, Json(created.into())))
}

/// The database's webhooks.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "list_database_webhooks",
    path = "/databases/{id}/webhooks",
    params(("id" = Uuid, Path, description = "Database id")),
    responses(
        (status = 200, body = ListDatabaseWebhooksResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 403, description = "No edit access to the database", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_webhooks_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>,
) -> Result<Json<ListDatabaseWebhooksResponse>, DatabaseWebhookError>
where
    Service: DatabaseWebhooksService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let webhooks = state
        .service
        .list_webhooks(access.entity_access_receipt)
        .await?;
    Ok(Json(ListDatabaseWebhooksResponse {
        webhooks: webhooks.into_iter().map(Into::into).collect(),
    }))
}

/// Delete a webhook; its URL stops working.
#[utoipa::path(
    delete,
    tag = "databases",
    operation_id = "delete_database_webhook",
    path = "/databases/{id}/webhooks/{webhook_id}",
    params(
        ("id" = Uuid, Path, description = "Database id"),
        ("webhook_id" = Uuid, Path, description = "Webhook id"),
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
pub async fn delete_webhook_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<EditAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>,
    Path(path): Path<(Uuid, WebhookId)>,
) -> Result<StatusCode, DatabaseWebhookError>
where
    Service: DatabaseWebhooksService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .delete_webhook(access.entity_access_receipt, path.1)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Insert rows through a webhook. The body is a JSON object, one row, or
/// an array of up to 100 objects, one row each. Keys name columns by name
/// (ignoring case) or id; `null` leaves a cell empty. Values may be loose:
/// `"45"` for a number, `"true"` for a checkbox, a label or labels for a
/// select, `2026-10-09` for a date. Nothing is written unless every row fits.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "deliver_database_webhook",
    path = "/databases/webhooks/{token}",
    params(("token" = String, Path, description = "The webhook's secret token")),
    request_body(content = serde_json::Value, description = "A row, or an array of rows"),
    responses(
        (status = 201, body = DatabaseWebhookDeliveryResponse),
        (status = 400, description = "The payload does not fit the table; nothing was written", body = InvalidDatabaseWebhookPayloadResponse),
        (status = 403, description = "The webhook's creator can no longer edit the database", body = ErrorResponse),
        (status = 404, description = "No such webhook", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn deliver_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabaseWebhooksRouterState<Service, EntityAccess, Authorization>>,
    Path(token): Path<String>,
    body: Bytes,
) -> Result<(StatusCode, Json<DatabaseWebhookDeliveryResponse>), DatabaseWebhookError>
where
    Service: DatabaseWebhooksService,
{
    // Senders differ in the content type they claim, so any body that
    // parses as JSON is taken.
    let payload: serde_json::Value = serde_json::from_slice(&body).map_err(|error| {
        DatabaseWebhookError::InvalidPayload(vec![PayloadProblem {
            row: None,
            field: None,
            message: format!("the body is not JSON: {error}"),
        }])
    })?;
    let delivery = state.service.deliver(&token, &payload).await?;
    Ok((StatusCode::CREATED, Json(delivery.into())))
}

/// The webhooks endpoints and their schemas, for the host's OpenAPI
/// document.
#[derive(OpenApi)]
#[openapi(
    paths(
        create_webhook_handler,
        list_webhooks_handler,
        delete_webhook_handler,
        deliver_handler,
    ),
    components(schemas(
        CreateDatabaseWebhookRequest,
        CreatedDatabaseWebhookResponse,
        DatabaseWebhookResponse,
        ListDatabaseWebhooksResponse,
        DatabaseWebhookDeliveryResponse,
        InvalidDatabaseWebhookPayloadResponse,
        DatabaseWebhookPayloadProblem,
    ))
)]
pub struct DatabaseWebhooksApi;
