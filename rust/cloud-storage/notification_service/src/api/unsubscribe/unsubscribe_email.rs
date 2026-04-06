use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use decode_jwt::DecodedJwt;
use model::response::{EmptyResponse, ErrorResponse};

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
#[tracing::instrument(skip(ctx, decoded_jwt))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    decoded_jwt: DecodedJwt,
) -> Result<Response, Response> {
    let email = decoded_jwt.user_context.user_id.replace("macro|", "");
    notification_db_client::unsubscribe::email::upsert_email_unsubscribe(&ctx.db, &email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, email=?email, "unable to unsubscribe email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to unsubscribe email".into(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
