use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use model_notifications::UserUnsubscribe;

use crate::api::context::ApiContext;
use model::user::UserContext;

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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let unsubscribe_items = notification_db_client::unsubscribe::get::get_user_unsubscribes(
        &ctx.db,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to unsubscribe item");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to unsubscribe item",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(unsubscribe_items)).into_response())
}
