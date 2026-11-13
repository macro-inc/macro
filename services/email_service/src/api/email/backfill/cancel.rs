use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    Extension,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::backfill_jobs::{BackfillCancelError, BackfillJobAccess};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
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
            (status = 201, body=EmptyResponse),
            (status = 429, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    link: Extension<Link>,
    Json(req_body): Json<CancelBackfillParams>,
) -> Result<Response, Response> {
    ctx.backfill_jobs
        .cancel(req_body.job_id, BackfillJobAccess::Inbox(link.id))
        .await
        .map_err(cancel_error_response)?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// Render cancellation outcomes identically for public and internal requests.
pub(crate) fn cancel_error_response<E>(error: BackfillCancelError<E>) -> Response {
    let (status, message) = match error {
        BackfillCancelError::Lookup(error) => return super::get::job_error_response(error),
        BackfillCancelError::AlreadyCancelled => (StatusCode::BAD_REQUEST, "job already cancelled"),
        BackfillCancelError::AlreadyComplete => (StatusCode::BAD_REQUEST, "job already completed"),
        BackfillCancelError::AlreadyFailed => (StatusCode::BAD_REQUEST, "job already failed"),
        BackfillCancelError::Update(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "error updating job status",
        ),
    };
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
