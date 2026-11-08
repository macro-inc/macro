use crate::api::context::AuthorizationService;
use axum::extract::{Path, State};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email_types::email::service::backfill::BackfillJob;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use shared_types::response::ErrorResponse;
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
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(job_id): Path<Uuid>,
) -> Result<Response, Response> {
    let job = email_db_client::backfill::job::get::get_backfill_job(&db, job_id)
        .await
        .map_err(|e| {
            tracing::warn!(error=?e, "error fetching backfill job");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "error fetching job".into(),
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "job does not exist".into(),
                }),
            )
                .into_response()
        })?;

    Ok(Json(GetBackfillJobResponse { job }).into_response())
}
