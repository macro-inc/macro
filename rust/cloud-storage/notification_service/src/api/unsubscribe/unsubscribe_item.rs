use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::{EmptyResponse, ErrorResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::api::context::ApiContext;

use model::user::UserContext;

#[derive(Deserialize, Serialize, ToSchema)]
pub struct UnsubscribeItemPathParams {
    pub item_type: String,
    pub item_id: String,
}

/// Unsubscribes a user from a given item for notifications.
#[utoipa::path(
        post,
        operation_id = "unsubscribe_item",
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
    notification_db_client::unsubscribe::item::upsert_unsubscribed_item_user(
        &ctx.db,
        &user_context.user_id,
        &item_id,
        &item_type,
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

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
