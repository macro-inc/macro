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

pub(super) fn deserialize_item_type<'de, D: serde::Deserializer<'de>>(
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
    /// Keep notifying for messages that @mention the user directly and silence
    /// the rest. Channels only; cannot be combined with `snoozed_until`.
    #[serde(default)]
    pub mentions_only: bool,
}

/// Unsubscribes a user from a given item for notifications, or, with
/// `mentions_only`, from everything on a channel but their direct mentions.
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
    let user_id = user.authorization.user.macro_user_id;
    let entity = item_type.with_entity_string(item_id);

    let saved = match (params.mentions_only, params.snoozed_until) {
        (true, Some(_)) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "mentions_only cannot be combined with snoozed_until".into(),
                }),
            )
                .into_response());
        }
        (true, None) => {
            ctx.item_preferences
                .set_mentions_only(user_id, entity)
                .await
        }
        (false, snoozed_until) => {
            ctx.item_preferences
                .set(user_id, entity, snoozed_until, chrono::Utc::now())
                .await
        }
    };

    saved.map_err(|e| {
        if matches!(
            e,
            ItemNotificationPreferenceError::InvalidDeadline
                | ItemNotificationPreferenceError::MentionsOnlyUnsupported
        ) {
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
