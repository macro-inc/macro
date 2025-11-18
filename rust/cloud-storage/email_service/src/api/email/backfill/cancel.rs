use crate::api::ApiContext;
use axum::{
    Extension,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::{EmptyResponse, ErrorResponse};
use model::user::UserContext;
use models_email::email::service::backfill::BackfillJobStatus;
use models_email::email::service::link::Link;
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct CancelBackfillParams {
    pub job_id: Uuid,
}

/// Cancel a backfill job.
#[utoipa::path(
    delete,
    tag = "Init",
    path = "/email/backfill/gmail",
    operation_id = "cancel_backfill_gmail",
    request_body = CancelBackfillParams,
    responses(
            (status = 204),
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
    Json(req_body): Json<CancelBackfillParams>,
) -> Result<Response, Response> {
    let job = email_db_client::backfill::job::get::get_backfill_job_with_link_id(
        &ctx.db,
        req_body.job_id,
        link.id,
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
            req_body.job_id
        );
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "job does not exist",
            }),
        )
            .into_response()
    })?;

    match job.status {
        BackfillJobStatus::Cancelled => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already cancelled",
            }),
        )
            .into_response()),
        BackfillJobStatus::Complete => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already completed",
            }),
        )
            .into_response()),
        BackfillJobStatus::Failed => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already failed",
            }),
        )
            .into_response()),
        _ => Ok(()),
    }?;

    email_db_client::backfill::job::update::update_backfill_job_status(
        &ctx.db,
        job.id,
        BackfillJobStatus::Cancelled,
    )
    .await
    .map_err(|e| {
        tracing::warn!(error=?e, "error updating backfill job status");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "error updating job status",
            }),
        )
            .into_response()
    })?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
