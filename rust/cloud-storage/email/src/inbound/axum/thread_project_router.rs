use axum::{
    Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::patch,
};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    ProjectBodyAccessLevelExtractor, ThreadAccessLevelExtractor,
};
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::get_thread_router::EmailThreadRouterState;

/// Request body for updating a thread's project.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThreadProjectRequest {
    /// The project ID to assign to the thread, or null to remove from project.
    pub project_id: Option<String>,
}

/// Response body for updating a thread's project.
#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateThreadProjectResponse {
    /// The previous project ID of the thread.
    pub old_project_id: Option<String>,
}

/// Errors from the update thread project handler.
#[derive(Debug, Error)]
pub enum UpdateThreadProjectError {
    /// Thread not found.
    #[error("Thread not found")]
    NotFound,
    /// Unauthorized.
    #[error("{0}")]
    Unauthorized(String),
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for UpdateThreadProjectError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, UpdateThreadProjectError::Internal(_)) {
            tracing::error!(error=?self, "update thread project error");
        }

        let status = match &self {
            UpdateThreadProjectError::NotFound => StatusCode::NOT_FOUND,
            UpdateThreadProjectError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            UpdateThreadProjectError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailErr> for UpdateThreadProjectError {
    fn from(err: EmailErr) -> Self {
        match err {
            EmailErr::ThreadNotFound => UpdateThreadProjectError::NotFound,
            EmailErr::Unauthorized => UpdateThreadProjectError::Unauthorized(err.to_string()),
            other => UpdateThreadProjectError::Internal(other),
        }
    }
}

/// Create the thread project router with a `PATCH /{thread_id}/project` handler.
pub fn thread_project_router<S, T, Svc>(state: EmailThreadRouterState<T, Svc>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: EmailService,
    Svc: EntityAccessService,
{
    Router::new()
        .route(
            "/{thread_id}/project",
            patch(update_thread_project_handler::<T, Svc>),
        )
        .with_state(state)
}

/// Update the project assignment for a thread.
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/{thread_id}/project",
    operation_id = "update_thread_project",
    request_body = UpdateThreadProjectRequest,
    params(
        ("thread_id" = String, Path, description = "Thread ID"),
    ),
    responses(
        (status = 200, body = UpdateThreadProjectResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, access, project))]
pub async fn update_thread_project_handler<T: EmailService, Svc: EntityAccessService>(
    State(state): State<EmailThreadRouterState<T, Svc>>,
    access: ThreadAccessLevelExtractor<EditAccessLevel, Svc>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, UpdateThreadProjectRequest, Svc>,
) -> Result<Json<UpdateThreadProjectResponse>, UpdateThreadProjectError> {
    let project_receipt = match project {
        ProjectBodyAccessLevelExtractor::FoundProject {
            entity_access_receipt,
            ..
        } => Some(entity_access_receipt),
        ProjectBodyAccessLevelExtractor::ProjectNotInBody { .. } => None,
    };

    let old_project_id = state
        .service
        .update_thread_project(access.entity_access_receipt, project_receipt)
        .await?;

    Ok(Json(UpdateThreadProjectResponse { old_project_id }))
}
