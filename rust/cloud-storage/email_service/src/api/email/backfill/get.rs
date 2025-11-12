use crate::api::ApiContext;
use axum::extract::{Path, State};
use axum::{
    Extension,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use model::user::UserContext;
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
            (status = 201, body=GetBackfillJobResponse),
            (status = 429, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Path(job_id): Path<Uuid>,
) -> Result<Response, Response> {
    let job = email_db_client::backfill::job::get::get_backfill_job_with_link_id(
        &ctx.db, job_id, link.id,
    )
    .await
    .map_err(|e| {
        tracing::warn!(error=?e, "error fetching backfill job");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "error fetching job",
            }),
        )
            .into_response()
    })?
    .ok_or_else(|| {
        tracing::warn!(
            "job not found during cancel backfill request for link_id {} job_id {}",
            link.id,
            job_id
        );
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "job does not exist",
            }),
        )
            .into_response()
    })?;

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
            (status = 201, body=GetActiveBackfillJobResponse),
            (status = 429, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn active_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Response, GetActiveBackfillError> {
    let job = email_db_client::backfill::job::get::get_active_backfill_job(&ctx.db, link.id)
        .await
        .map_err(GetActiveBackfillError::QueryError)?
        .ok_or_else(|| GetActiveBackfillError::NotFound(link.id))?;

    Ok(Json(GetActiveBackfillJobResponse { job }).into_response())
}

#[derive(Debug, Error, AsRefStr)]
pub enum GetActiveBackfillError {
    #[error("No active backfill job found for link {0}")]
    NotFound(Uuid),

    #[error("Failed to get active backfill job from database")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetActiveBackfillError {
    fn into_response(self) -> Response {
        let status_code = match self {
            GetActiveBackfillError::NotFound(_) => StatusCode::NOT_FOUND,
            GetActiveBackfillError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetActiveBackfillError", 
                variant = self.as_ref(),
                "Internal server error");
        }

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().as_str(),
            }),
        )
            .into_response()
    }
}
