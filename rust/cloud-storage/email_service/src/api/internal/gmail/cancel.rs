use crate::api::ApiContext;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use models_email::email::service::backfill::BackfillJobStatus;
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct BackfillCancelParams {
    pub job_id: Uuid,
}

/// Internal endpoint to cancel backfill jobs.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Json(req_body): Json<BackfillCancelParams>,
) -> Result<Response, Response> {
    let job = email_db_client::backfill::job::get::get_backfill_job(&ctx.db, req_body.job_id)
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
                "job not found for cancel backfill request: {}",
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

    if job.status == BackfillJobStatus::Cancelled {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already cancelled",
            }),
        )
            .into_response());
    } else if job.status == BackfillJobStatus::Complete {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already completed",
            }),
        )
            .into_response());
    } else if job.status == BackfillJobStatus::Failed {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "job already failed",
            }),
        )
            .into_response());
    }

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
