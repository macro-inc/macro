//! Atomic changes to the authenticated user's item notification preferences.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_kind::EntityType;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use notification::domain::item_preferences::ItemNotificationPreferenceError;
use serde::Deserialize;
use shared_types::response::{EmptyResponse, ErrorResponse};
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService};

#[derive(Deserialize, ToSchema)]
pub struct BulkItem {
    #[serde(deserialize_with = "super::unsubscribe_item::deserialize_item_type")]
    pub item_type: EntityType,
    pub item_id: String,
}

#[derive(Deserialize, ToSchema)]
pub struct BulkSetItemsRequest {
    pub items: Vec<BulkItem>,
    /// A future resume time. Omit to mute indefinitely.
    pub snoozed_until: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Deserialize, ToSchema)]
pub struct BulkRemoveItemsRequest {
    pub items: Vec<BulkItem>,
}

fn error_response(error: ItemNotificationPreferenceError) -> Response {
    match error {
        ItemNotificationPreferenceError::Repository(error) => {
            tracing::error!(?error, "unable to update notification preferences");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update notification preferences".into(),
                }),
            )
                .into_response()
        }
        error => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: error.to_string().into(),
            }),
        )
            .into_response(),
    }
}

/// Atomically mute or snooze items for the authenticated user.
#[utoipa::path(
    post,
    operation_id = "unsubscribe_items",
    path = "/unsubscribe/items",
    request_body = BulkSetItemsRequest,
    responses(
        (status = 200, body = EmptyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, request))]
pub async fn unsubscribe_items(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<BulkSetItemsRequest>,
) -> Result<Response, Response> {
    let entities = request
        .items
        .into_iter()
        .map(|item| item.item_type.with_entity_string(item.item_id))
        .collect();
    ctx.item_preferences
        .set_bulk(
            user.authorization.user.macro_user_id,
            entities,
            request.snoozed_until,
            chrono::Utc::now(),
        )
        .await
        .map_err(error_response)?;
    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}

/// Atomically resume delivery for the authenticated user's items.
#[utoipa::path(
    delete,
    operation_id = "remove_unsubscribe_items",
    path = "/unsubscribe/items",
    request_body = BulkRemoveItemsRequest,
    responses(
        (status = 200, body = EmptyResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, request))]
pub async fn remove_unsubscribe_items(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<BulkRemoveItemsRequest>,
) -> Result<Response, Response> {
    let entities = request
        .items
        .into_iter()
        .map(|item| item.item_type.with_entity_string(item.item_id))
        .collect();
    ctx.item_preferences
        .remove_bulk(user.authorization.user.macro_user_id, entities)
        .await
        .map_err(error_response)?;
    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
