use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use email::domain::{models::EmailErr, ports::EmailService};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug)]
pub struct ArchiveThreadError(EmailErr);
impl IntoResponse for ArchiveThreadError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            EmailErr::ThreadNotFound | EmailErr::ThreadEmpty => StatusCode::NOT_FOUND,
            EmailErr::Unauthorized => StatusCode::FORBIDDEN,
            EmailErr::ThreadHasNoInboundMessages => StatusCode::CONFLICT,
            EmailErr::TooManyThreads(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status.is_server_error() {
            tracing::error!(error=?self.0,"email thread action failed");
        }
        (
            status,
            if status.is_server_error() {
                "Email action failed".to_owned()
            } else {
                self.0.to_string()
            },
        )
            .into_response()
    }
}
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct ArchiveThreadRequest {
    pub value: bool,
}

/// Change the archived status of a thread.
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/{id}/archived",
    operation_id = "archive_thread",
    request_body = ArchiveThreadRequest,
    responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, body), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err(Debug))]
pub async fn archived_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<ArchiveThreadRequest>,
) -> Result<Response, ArchiveThreadError> {
    ctx.email_service
        .service()
        .set_thread_archived(
            authorization.authorization.user.macro_user_id.clone(),
            thread_id,
            body.value,
        )
        .await
        .map_err(ArchiveThreadError)?;
    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct ArchiveThreadsRequest {
    pub thread_ids: Vec<Uuid>,
    pub value: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct ArchiveThreadsResponse {
    /// Threads whose archived status now matches the request.
    pub updated_thread_ids: Vec<Uuid>,
    /// Threads left unchanged because they could not be updated.
    pub failed_thread_ids: Vec<Uuid>,
}

/// Change the archived status of up to 100 threads, sending one provider
/// write per inbox. A thread that can't change is reported, not fatal.
#[utoipa::path(
    patch,
    tag = "Threads",
    path = "/email/threads/archived",
    operation_id = "archive_threads",
    request_body = ArchiveThreadsRequest,
    responses(
            (status = 200, body=ArchiveThreadsResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, body), fields(user_id=authorization.authorization.user.user_context.user_id, thread_count=body.thread_ids.len()), err(Debug))]
pub async fn archived_batch_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(body): Json<ArchiveThreadsRequest>,
) -> Result<Response, ArchiveThreadError> {
    let result = ctx
        .email_service
        .service()
        .set_threads_archived(
            authorization.authorization.user.macro_user_id.clone(),
            body.thread_ids,
            body.value,
        )
        .await
        .map_err(ArchiveThreadError)?;
    Ok((
        StatusCode::OK,
        Json(ArchiveThreadsResponse {
            updated_thread_ids: result.updated_thread_ids,
            failed_thread_ids: result.failed_thread_ids,
        }),
    )
        .into_response())
}
