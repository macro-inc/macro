use axum::extract::{Path, State};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use models_email::email::service::backfill::BackfillJob;
use sqlx::PgPool;
use sqlx::types::Uuid;
use utoipa::ToSchema;

/// The response returned from the get backfill job endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetBackfillJobResponse {
    pub job: BackfillJob,
}

/// Get a backfill job.
pub async fn handler(
    State(db): State<PgPool>,
    Path(job_id): Path<Uuid>,
) -> Result<Response, Response> {
    let job = email_db_client::backfill::job::get::get_backfill_job(&db, job_id)
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
