//! HTTP handlers for notification type preferences (enable/disable).

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::service::NotificationReader;

use super::NotificationRouterState;

/// Path parameter for a notification event type.
#[derive(Deserialize)]
pub struct NotificationEventTypePath {
    /// The notification event type (e.g. "channel_message_send").
    pub notification_event_type: String,
}

/// Response for listing disabled notification types.
#[derive(Debug, Serialize, ToSchema)]
pub struct GetNotificationTypePreferencesResponse {
    /// The notification types that the user has disabled.
    pub disabled_types: Vec<String>,
}

/// Get the notification types that the user has disabled.
#[utoipa::path(
    get,
    operation_id = "get_notification_type_preferences",
    path = "/v1/user_notifications/preferences",
    responses(
        (status = 200, body = GetNotificationTypePreferencesResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_notification_type_preferences<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
) -> Result<
    Json<GetNotificationTypePreferencesResponse>,
    (StatusCode, Json<ErrorResponse<'static>>),
> {
    let disabled = state
        .inner
        .get_disabled_notification_types(macro_user.macro_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get notification type preferences");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to get notification type preferences".into(),
                }),
            )
        })?;

    Ok(Json(GetNotificationTypePreferencesResponse {
        disabled_types: disabled
            .into_iter()
            .map(|d| d.notification_event_type)
            .collect(),
    }))
}

/// Disable a notification type for the authenticated user.
#[utoipa::path(
    put,
    operation_id = "disable_notification_type",
    path = "/v1/user_notifications/preferences/{notification_event_type}/disable",
    params(
        ("notification_event_type" = String, Path, description = "The notification event type to disable"),
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn disable_notification_type<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Path(NotificationEventTypePath {
        notification_event_type,
    }): Path<NotificationEventTypePath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    // make sure the notification to block is one that matches the list
    let true = state
        .blockable_notification_typenames
        .contains(notification_event_type.as_str())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: format!(
                    "Cannot block notification type {notification_event_type}. Expected one of {:?}",
                    state.blockable_notification_typenames
                )
                .into(),
            }),
        ));
    };

    state
        .inner
        .disable_notification_type(macro_user.macro_user_id, &notification_event_type)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to disable notification type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to disable notification type".into(),
                }),
            )
        })?;

    Ok(Json(()))
}

/// Re-enable a notification type for the authenticated user.
#[utoipa::path(
    put,
    operation_id = "enable_notification_type",
    path = "/v1/user_notifications/preferences/{notification_event_type}/enable",
    params(
        ("notification_event_type" = String, Path, description = "The notification event type to enable"),
    ),
    responses(
        (status = 200),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn enable_notification_type<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    macro_user: MacroUserExtractor,
    Path(NotificationEventTypePath {
        notification_event_type,
    }): Path<NotificationEventTypePath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    state
        .inner
        .enable_notification_type(macro_user.macro_user_id, &notification_event_type)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to enable notification type");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to enable notification type".into(),
                }),
            )
        })?;

    Ok(Json(()))
}
