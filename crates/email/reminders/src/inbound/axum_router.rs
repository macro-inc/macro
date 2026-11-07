//! Axum router for reminders endpoints.

pub mod email_collection;

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use uuid::Uuid;

use crate::domain::{models::ReminderError, ports::RemindersService};

/// Router state for reminders endpoints.
pub struct RemindersRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for RemindersRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> RemindersRouterState<S, Eas, Auth>
where
    S: RemindersService,
    Eas: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<RemindersRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &RemindersRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<RemindersRouterState<S, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RemindersRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the email snooze router.
pub fn reminders_router<S, Eas, Auth, T>(state: RemindersRouterState<S, Eas, Auth>) -> Router<T>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/email/collection",
            get(email_collection::list_email_reminders_handler::<S, Eas, Auth>),
        )
        .route(
            "/email/{thread_id}",
            get(get_email_followup_handler::<S, Eas, Auth>)
                .put(set_email_followup_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

impl IntoResponse for ReminderError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            ReminderError::NotFound | ReminderError::EntityNotFound => StatusCode::NOT_FOUND,
            ReminderError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ReminderError::EntityAccessDenied => StatusCode::FORBIDDEN,
            ReminderError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            ReminderError::Internal(_) => {
                tracing::error!(error=?self, "reminders internal server error");
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

/// Read an email follow-up and reconcile inbound reply cancellation.
#[utoipa::path(get, tag = "reminders", operation_id = "get_email_followup",
    path = "/reminders/email/{thread_id}", params(("thread_id" = Uuid, Path)),
    responses((status = 200, body = crate::domain::email_followup::EmailFollowupResponse),
              (status = 403, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
pub async fn get_email_followup_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<crate::domain::email_followup::EmailFollowupResponse>, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(crate::domain::email_followup::EmailFollowupResponse {
        followup: state
            .service
            .get_email_followup(user.authorization.user.macro_user_id, thread_id)
            .await?,
    }))
}

/// Schedule, edit or remove one email follow-up as an idempotent operation.
#[utoipa::path(put, tag = "reminders", operation_id = "set_email_followup",
    path = "/reminders/email/{thread_id}", params(("thread_id" = Uuid, Path)),
    request_body = crate::domain::email_followup::EmailFollowupCommand,
    responses((status = 200, body = crate::domain::email_followup::EmailFollowup),
              (status = 400, body = ErrorResponse), (status = 403, body = ErrorResponse),
              (status = 500, body = ErrorResponse)))]
pub async fn set_email_followup_handler<S, Eas, Auth>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(thread_id): Path<Uuid>,
    Json(command): Json<crate::domain::email_followup::EmailFollowupCommand>,
) -> Result<Json<crate::domain::email_followup::EmailFollowup>, ReminderError>
where
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .execute_email_followup(user.authorization.user.macro_user_id, thread_id, command)
            .await?,
    ))
}
