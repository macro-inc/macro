use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::message_reads::ThreadOwnerError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;
use uuid::Uuid;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(thread_id): Path<Uuid>,
) -> Result<Response, Response> {
    let response = ctx
        .message_reads
        .thread_owner(thread_id)
        .await
        .map_err(|error| {
            let (status, message) = match error {
                ThreadOwnerError::NotFound => (StatusCode::NOT_FOUND, "thread not found"),
                ThreadOwnerError::InvalidOwner => {
                    (StatusCode::BAD_REQUEST, "invalid macro user id")
                }
                ThreadOwnerError::Query(error) => {
                    let e = error.into_inner();
                    tracing::error!(error=?e, "unable to get owner for thread");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "unable to get owner for thread",
                    )
                }
            };
            (
                status,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        })?;
    Ok((StatusCode::OK, Json(response)).into_response())
}
