use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use model_entity::EntityType;
use notification::domain::item_preferences::ItemNotificationPreferenceError;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::api::context::{ApiContext, AuthorizationService};

#[derive(Deserialize, Serialize, ToSchema, IntoParams)]
pub struct UnsubscribeItemPathParams {
    #[serde(deserialize_with = "deserialize_item_type")]
    pub item_type: EntityType,
    pub item_id: String,
}

fn deserialize_item_type<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<EntityType, D::Error> {
    let value = String::deserialize(deserializer)?;
    match value.as_str() {
        "email" | "thread" => Ok(EntityType::EmailThread),
        "foreign" => Ok(EntityType::ForeignEntity),
        value => value.parse().map_err(serde::de::Error::custom),
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct SnoozeParams {
    /// A future resume time. Omit to mute indefinitely.
    pub snoozed_until: Option<chrono::DateTime<chrono::Utc>>,
}

/// Unsubscribes a user from a given item for notifications.
#[utoipa::path(
        post,
        operation_id = "unsubscribe_item",
        path = "/unsubscribe/item/{item_type}/{item_id}",
        params(UnsubscribeItemPathParams, SnoozeParams),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(UnsubscribeItemPathParams { item_type, item_id }): Path<UnsubscribeItemPathParams>,
    Query(params): Query<SnoozeParams>,
) -> Result<Response, Response> {
    ctx.item_preferences
        .set(
            user.authorization.user.macro_user_id,
            item_type.with_entity_string(item_id),
            params.snoozed_until,
            chrono::Utc::now(),
        )
        .await
        .map_err(|e| {
            if matches!(e, ItemNotificationPreferenceError::InvalidDeadline) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: e.to_string().into(),
                    }),
                )
                    .into_response();
            }
            tracing::error!(error=?e, "unable to unsubscribe item");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to unsubscribe item".into(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
