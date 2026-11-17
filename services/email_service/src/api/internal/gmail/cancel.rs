use crate::api::email::backfill::cancel::cancel_error_response;
use crate::api::{ApiContext, context::AuthorizationService};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::backfill_jobs::BackfillJobAccess;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
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
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(req_body): Json<BackfillCancelParams>,
) -> Result<Response, Response> {
    ctx.backfill_jobs
        .cancel(req_body.job_id, BackfillJobAccess::Internal)
        .await
        .map_err(cancel_error_response)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
