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
