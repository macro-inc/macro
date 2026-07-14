use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use decode_jwt::DecodedJwt;
use model::response::ErrorResponse;
use model_notifications::UserUnsubscribe;

use crate::api::context::ApiContext;

/// Gets the users unsubscribe items.
#[utoipa::path(
        get,
        operation_id = "get_unsubscribes",
        path = "/unsubscribe",
        responses(
            (status = 200, body=Vec<UserUnsubscribe>),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, decoded_jwt))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    decoded_jwt: DecodedJwt,
) -> Result<Response, Response> {
    let unsubscribe_items = notification_db_client::unsubscribe::get::get_user_unsubscribes(
        &ctx.db,
        &decoded_jwt.user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to unsubscribe item");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to unsubscribe item".into(),
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(unsubscribe_items)).into_response())
}
