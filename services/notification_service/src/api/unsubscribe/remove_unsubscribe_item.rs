use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};

use crate::api::context::{ApiContext, AuthorizationService};

use super::unsubscribe_item::UnsubscribeItemPathParams;

/// Removes a unsubscribe item for a user.
#[utoipa::path(
        delete,
        operation_id = "remove_unsubscribe_item",
        path = "/unsubscribe/item/{item_type}/{item_id}",
        params(UnsubscribeItemPathParams),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(UnsubscribeItemPathParams { item_type, item_id }): Path<UnsubscribeItemPathParams>,
) -> Result<Response, Response> {
    notification_db_client::unsubscribe::item::remove_unsubscribed_item_user(
        &ctx.db,
        &user.authorization.user.user_context.user_id,
        &item_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to remove unsubscribe item");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to remove unsubscribe item".into(),
            }),
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
