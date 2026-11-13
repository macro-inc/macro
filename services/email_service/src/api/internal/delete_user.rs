use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;

#[tracing::instrument(skip(ctx))]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(fusionauth_user_id): Path<String>,
) -> Result<Response, Response> {
    ctx.user_inbox_deletion
        .request_user_deletion(&fusionauth_user_id)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: error.to_string().into(),
                }),
            )
                .into_response()
        })?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
