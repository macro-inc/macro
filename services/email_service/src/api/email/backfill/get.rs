use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::{Path, State};
use axum::{
    Extension,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::backfill_jobs::{BackfillJobAccess, BackfillLookupError};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use models_email::email::service::backfill::BackfillJob;
use models_email::email::service::link::Link;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

/// The response returned from the get backfill job endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetBackfillJobResponse {
    pub job: BackfillJob,
}

/// Get a backfill job.
#[utoipa::path(
    get,
    tag = "Init",
    path = "/email/backfill/gmail/{id}",
    operation_id = "get_backfill_gmail",
    params(
        ("id" = Uuid, Path, description = "Job ID."),
    ),
    responses(
            (status = 200, body=GetBackfillJobResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
    Path(job_id): Path<Uuid>,
) -> Result<Response, Response> {
    let job = ctx
        .backfill_jobs
        .get(job_id, BackfillJobAccess::Inbox(link.id))
        .await
        .map_err(job_error_response)?;

    Ok(Json(GetBackfillJobResponse { job }).into_response())
}

/// The response returned from the get backfill job endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetActiveBackfillJobResponse {
    pub job: BackfillJob,
}

/// Get any active backfill job for the user.
#[utoipa::path(
    get,
    tag = "Init",
    path = "/email/backfill/gmail/active",
    operation_id = "get_backfill_gmail_active",
    responses(
            (status = 200, body=GetActiveBackfillJobResponse),
            (status = 204, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err)]
pub async fn active_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Response, GetActiveBackfillError> {
    let job = ctx
        .backfill_jobs
        .active(link.id)
        .await
        .map_err(|error| GetActiveBackfillError::QueryError(error.into_inner()))?;

    match job {
        Some(job) => Ok(Json(GetActiveBackfillJobResponse { job }).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

#[derive(Debug, Error, AsRefStr)]
pub enum GetActiveBackfillError {
    #[error("Failed to get active backfill job from database")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetActiveBackfillError {
    fn into_response(self) -> Response {
        let status_code = match self {
            GetActiveBackfillError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// The response returned from the list backfill jobs endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListBackfillJobsResponse {
    pub jobs: Vec<BackfillJob>,
}

/// List all backfill jobs for the authenticated user, across every link they
/// own. Scoped by the user's fusionauth id from the request context rather than
/// a single resolved link.
#[utoipa::path(
    get,
    tag = "Init",
    path = "/email/backfill/gmail",
    operation_id = "list_backfill_gmail",
    responses(
            (status = 200, body=ListBackfillJobsResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn list_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, ListBackfillJobsError> {
    let jobs = ctx
        .backfill_jobs
        .list(&authorization.authorization.user.user_context.fusion_user_id)
        .await
        .map_err(|error| ListBackfillJobsError::QueryError(error.into_inner()))?;

    Ok(Json(ListBackfillJobsResponse { jobs }).into_response())
}

#[derive(Debug, Error, AsRefStr)]
pub enum ListBackfillJobsError {
    #[error("Failed to list backfill jobs from database")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for ListBackfillJobsError {
    fn into_response(self) -> Response {
        let status_code = match self {
            ListBackfillJobsError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Render the shared public/internal job lookup failures.
pub(crate) fn job_error_response<E>(error: BackfillLookupError<E>) -> Response {
    let (status, message) = match error {
        BackfillLookupError::Query(_) => (StatusCode::INTERNAL_SERVER_ERROR, "error fetching job"),
        BackfillLookupError::NotFound => (StatusCode::NOT_FOUND, "job does not exist"),
    };
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
