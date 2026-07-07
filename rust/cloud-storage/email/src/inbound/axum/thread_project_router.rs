use axum::{
    Json, Router, extract::State, http::StatusCode, response::IntoResponse, routing::patch,
};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    ProjectBodyAccessLevelExtractor, ThreadAccessLevelExtractor,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use model_entity::EntityType;
use model_error_response::ErrorResponse;
use thiserror::Error;
use uuid::Uuid;

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
pub fn thread_project_router<S, T, Svc, M>(state: EmailThreadRouterState<T, Svc, M>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: EmailService,
    Svc: EntityAccessService,
    M: EntityAccessManagementService,
{
    Router::new()
        .route(
            "/{thread_id}/project",
            patch(update_thread_project_handler::<T, Svc, M>),
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
pub async fn update_thread_project_handler<
    T: EmailService,
    Svc: EntityAccessService,
    M: EntityAccessManagementService,
>(
    State(state): State<EmailThreadRouterState<T, Svc, M>>,
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

    let thread_id = access.entity_access_receipt.entity().entity_id.clone();
    let new_project_id = project_receipt
        .as_ref()
        .map(|r| r.entity().entity_id.clone());

    let old_project_id = state
        .service
        .update_thread_project(access.entity_access_receipt, project_receipt)
        .await?;

    // Sync denormalized entity_access rows for the containing project.
    // Best-effort: the project assignment itself already succeeded.
    if old_project_id != new_project_id
        && let Ok(thread_uuid) = Uuid::parse_str(&thread_id)
    {
        if let Some(old) = old_project_id
            .as_deref()
            .and_then(|p| Uuid::parse_str(p).ok())
        {
            let _ = state
                .entity_access_management_service
                .remove_entity_from_project(&thread_uuid, EntityType::EmailThread, &old)
                .await
                .inspect_err(
                    |e| tracing::error!(error=?e, project_id=%old, "unable to remove thread project access"),
                );
        }
        if let Some(new) = new_project_id
            .as_deref()
            .and_then(|p| Uuid::parse_str(p).ok())
        {
            let _ = state
                .entity_access_management_service
                .add_entity_to_project(&thread_uuid, EntityType::EmailThread, &new)
                .await
                .inspect_err(
                    |e| tracing::error!(error=?e, project_id=%new, "unable to add thread project access"),
                );
        }
    }

    Ok(Json(UpdateThreadProjectResponse { old_project_id }))
}
