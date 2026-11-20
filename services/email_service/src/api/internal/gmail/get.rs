use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::backfill::get::job_error_response;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Json, Response};
use email::domain::backfill_jobs::BackfillJobAccess;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use models_email::email::service::backfill::BackfillJob;
use sqlx::types::Uuid;
use utoipa::ToSchema;

/// The response returned from the get backfill job endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetBackfillJobResponse {
    pub job: BackfillJob,
}

/// Get a backfill job.
pub async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(job_id): Path<Uuid>,
) -> Result<Response, Response> {
    let job = ctx
        .backfill_jobs
        .get(job_id, BackfillJobAccess::Internal)
        .await
        .map_err(job_error_response)?;

    Ok(Json(GetBackfillJobResponse { job }).into_response())
}
