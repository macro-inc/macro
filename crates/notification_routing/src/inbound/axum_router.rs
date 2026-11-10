//! Axum router for a person managing their notification stacks.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{NewStack, NotificationStack, StackChanges, StackError},
    ports::NotificationStackService,
};

/// Router state for notification stack endpoints.
pub struct NotificationStackRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for NotificationStackRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> NotificationStackRouterState<S, Auth>
where
    S: NotificationStackService,
{
    /// Create router state from a shared service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<NotificationStackRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &NotificationStackRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the notification stack router.
///
/// Routes:
/// - `GET /` — the caller's stacks in order.
/// - `POST /` — create a stack after the caller's last one.
/// - `PUT /order` — put the caller's stacks in a new order.
/// - `PATCH /{id}` — change one of the caller's stacks.
/// - `DELETE /{id}` — delete one of the caller's stacks.
pub fn notification_stack_router<S, Auth, T>(
    state: NotificationStackRouterState<S, Auth>,
) -> Router<T>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_notification_stacks_handler::<S, Auth>)
                .post(create_notification_stack_handler::<S, Auth>),
        )
        .route(
            "/order",
            put(reorder_notification_stacks_handler::<S, Auth>),
        )
        .route(
            "/{id}",
            patch(update_notification_stack_handler::<S, Auth>)
                .delete(delete_notification_stack_handler::<S, Auth>),
        )
        .with_state(state)
}

/// The caller's stacks in the order they are tried.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStacks {
    /// The stacks, first tried first.
    pub stacks: Vec<NotificationStack>,
}

/// A new order for the caller's stacks.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationStackOrder {
    /// Every one of the caller's stack ids, first tried first.
    pub ids: Vec<Uuid>,
}

/// Path params naming one stack.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct NotificationStackParams {
    /// The stack's id.
    pub id: Uuid,
}

/// List the caller's notification stacks.
#[utoipa::path(
    get,
    tag = "notification-stacks",
    operation_id = "list_notification_stacks",
    path = "/notification_stacks",
    responses(
        (status = 200, body = NotificationStacks),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_notification_stacks_handler<S, Auth>(
    State(state): State<NotificationStackRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<NotificationStacks>, StackError>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
{
    let stacks = state
        .service
        .list(&user.authorization.user.macro_user_id)
        .await?;
    Ok(Json(NotificationStacks { stacks }))
}

/// Create a notification stack for the caller.
#[utoipa::path(
    post,
    tag = "notification-stacks",
    operation_id = "create_notification_stack",
    path = "/notification_stacks",
    request_body = NewStack,
    responses(
        (status = 201, body = NotificationStack),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_notification_stack_handler<S, Auth>(
    State(state): State<NotificationStackRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(stack): Json<NewStack>,
) -> Result<(StatusCode, Json<NotificationStack>), StackError>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
{
    let created = state
        .service
        .create(&user.authorization.user.macro_user_id, stack)
        .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

/// Change one of the caller's notification stacks.
#[utoipa::path(
    patch,
    tag = "notification-stacks",
    operation_id = "update_notification_stack",
    path = "/notification_stacks/{id}",
    params(NotificationStackParams),
    request_body = StackChanges,
    responses(
        (status = 200, body = NotificationStack),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn update_notification_stack_handler<S, Auth>(
    State(state): State<NotificationStackRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(params): Path<NotificationStackParams>,
    Json(changes): Json<StackChanges>,
) -> Result<Json<NotificationStack>, StackError>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
{
    let updated = state
        .service
        .update(&user.authorization.user.macro_user_id, params.id, changes)
        .await?;
    Ok(Json(updated))
}

/// Delete one of the caller's notification stacks.
#[utoipa::path(
    delete,
    tag = "notification-stacks",
    operation_id = "delete_notification_stack",
    path = "/notification_stacks/{id}",
    params(NotificationStackParams),
    responses(
        (status = 204, description = "Stack deleted"),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_notification_stack_handler<S, Auth>(
    State(state): State<NotificationStackRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(params): Path<NotificationStackParams>,
) -> Result<StatusCode, StackError>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .delete(&user.authorization.user.macro_user_id, params.id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Put the caller's notification stacks in a new order.
#[utoipa::path(
    put,
    tag = "notification-stacks",
    operation_id = "reorder_notification_stacks",
    path = "/notification_stacks/order",
    request_body = NotificationStackOrder,
    responses(
        (status = 200, body = NotificationStacks),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn reorder_notification_stacks_handler<S, Auth>(
    State(state): State<NotificationStackRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(order): Json<NotificationStackOrder>,
) -> Result<Json<NotificationStacks>, StackError>
where
    S: NotificationStackService,
    Auth: MacroAuthorizationService,
{
    let stacks = state
        .service
        .reorder(&user.authorization.user.macro_user_id, order.ids)
        .await?;
    Ok(Json(NotificationStacks { stacks }))
}

impl IntoResponse for StackError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            StackError::Unavailable | StackError::NotFound => StatusCode::NOT_FOUND,
            StackError::Invalid(_) => StatusCode::BAD_REQUEST,
            StackError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            StackError::Internal(_) => {
                tracing::error!(error=?self, "notification stack internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
