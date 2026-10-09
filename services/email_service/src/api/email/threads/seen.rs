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
use uuid::Uuid;

#[derive(Debug)]
pub struct SeenThreadError(EmailErr);
impl IntoResponse for SeenThreadError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            EmailErr::ThreadNotFound | EmailErr::ThreadEmpty => StatusCode::NOT_FOUND,
            EmailErr::Unauthorized => StatusCode::FORBIDDEN,
            EmailErr::ThreadHasNoInboundMessages => StatusCode::CONFLICT,
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

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}
/// Called by FE when the user has seen a thread.
#[utoipa::path(
    post,
    tag = "Threads",
    path = "/email/threads/{id}/seen",
    operation_id = "thread_seen",
    params(
        ("id" = Uuid, Path, description = "Thread ID."),
    ),
    responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), err(Debug))]
pub async fn seen_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(PathParams { id: thread_id }): Path<PathParams>,
) -> Result<Response, SeenThreadError> {
    ctx.email_service
        .service()
        .mark_thread_seen(
            authorization.authorization.user.macro_user_id.clone(),
            thread_id,
        )
        .await
        .map_err(SeenThreadError)?;
    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
