use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use model_notifications::UserUnsubscribe;

use crate::api::context::{ApiContext, AuthorizationService};

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
#[tracing::instrument(skip(ctx, user))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    let unsubscribe_items = ctx
        .item_preferences
        .list(user.authorization.user.macro_user_id)
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

    let items: Vec<UserUnsubscribe> = unsubscribe_items
        .into_iter()
        .map(|item| UserUnsubscribe {
            item_id: item.entity.entity_id.into_owned(),
            item_type: item.entity.entity_type.to_string(),
            snoozed_until: item.snoozed_until,
        })
        .collect();
    Ok((StatusCode::OK, Json(items)).into_response())
}
