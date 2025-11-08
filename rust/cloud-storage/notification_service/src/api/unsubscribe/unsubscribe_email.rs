use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::{
    response::{EmptyResponse, ErrorResponse},
    user::UserContext,
};

use crate::api::context::ApiContext;

/// Unsubscribes a user from receiving emails
#[utoipa::path(
        post,
        operation_id = "unsubscribe_email",
        path = "/unsubscribe/email",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let email = user_context.user_id.replace("macro|", "");
    notification_db_client::unsubscribe::email::upsert_email_unsubscribe(&ctx.db, &email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, email=?email, "unable to unsubscribe email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to unsubscribe email",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
