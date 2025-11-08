use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::ApiContext;
use model::user::UserContext;

use super::unsubscribe_item::UnsubscribeItemPathParams;

/// Removes a unsubscribe item for a user.
#[utoipa::path(
        delete,
        operation_id = "remove_unsubscribe_item",
        path = "/unsubscribe/item/:item_type/:item_id",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(UnsubscribeItemPathParams { item_type, item_id }): Path<UnsubscribeItemPathParams>,
) -> Result<Response, Response> {
    notification_db_client::unsubscribe::item::remove_unsubscribed_item_user(
        &ctx.db,
        &user_context.user_id,
        &item_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to remove unsubscribe item");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to remove unsubscribe item",
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
