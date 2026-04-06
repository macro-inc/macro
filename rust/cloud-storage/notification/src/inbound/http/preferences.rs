//! HTTP handlers for notification type preferences (enable/disable).

use axum::{
    Json,
    extract::{OriginalUri, Path, Query, State},
    http::{StatusCode, uri::PathAndQuery},
    response::Html,
};
use cowlike::CowLike;
use decode_jwt::DecodedJwt;
use macro_env::Environment;
use macro_service_urls::EnvExtMacroServiceUrls;
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::{models::signing::SignedUrl, service::NotificationReader};

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
    decoded_jwt: DecodedJwt,
) -> Result<Json<GetNotificationTypePreferencesResponse>, (StatusCode, Json<ErrorResponse<'static>>)>
{
    let disabled = state
        .inner
        .get_disabled_notification_types(decoded_jwt.macro_user_id)
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
    decoded_jwt: DecodedJwt,
    Path(NotificationEventTypePath {
        notification_event_type,
    }): Path<NotificationEventTypePath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    disable_notification_type_inner(
        &state,
        decoded_jwt.macro_user_id.copied(),
        notification_event_type.as_str(),
    )
    .await
    .map(Json)
}

/// The query param value to extract the macro user id
#[derive(Deserialize)]
pub struct PresignedQueryParams {
    id: MacroUserIdStr<'static>,
}

/// Disable a notification type for the authenticated user via a GET request with a presigned url.
/// This guarantees the signed url was produced in a trusted environment
pub async fn presigned_disable_notification_type<S: NotificationReader>(
    State(state): State<NotificationRouterState<S>>,
    Path(NotificationEventTypePath {
        notification_event_type,
    }): Path<NotificationEventTypePath>,
    Query(params): Query<PresignedQueryParams>,
    original_uri: OriginalUri,
) -> Result<Html<String>, (StatusCode, Html<String>)> {
    let env = Environment::new_or_prod();
    let notification_service_url = env.notification_service();
    let to_verify = notification_service_url.join(
        original_uri
            .path_and_query()
            .map(PathAndQuery::as_str)
            .unwrap_or("/"),
    );

    let Ok(to_verify) = to_verify else {
        return Err((StatusCode::BAD_REQUEST, Html("Invalid link".to_string())));
    };

    let Some(_verified) = SignedUrl::verify(to_verify, state.hmac_signing_key.clone()) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Html("Invalid signature".to_string()),
        ));
    };

    disable_notification_type_inner(&state, params.id, notification_event_type.as_str())
        .await
        .map(|()| {
            Html(format!(
                "You have been unsubscribed from {notification_event_type}"
            ))
        })
        .map_err(|(status, Json(ErrorResponse { message }))| (status, Html(message.to_string())))
}

/// internal implementation of the GET/PUT methods to DRY up the code
async fn disable_notification_type_inner<S: NotificationReader>(
    state: &NotificationRouterState<S>,
    calling_user: MacroUserIdStr<'_>,
    notification_event_type: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse<'static>>)> {
    // make sure the notification to block is one that matches the list
    let true = state
        .blockable_notification_typenames
        .contains(notification_event_type)
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
        .disable_notification_type(calling_user, notification_event_type)
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

    Ok(())
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
    decoded_jwt: DecodedJwt,
    Path(NotificationEventTypePath {
        notification_event_type,
    }): Path<NotificationEventTypePath>,
) -> Result<Json<()>, (StatusCode, Json<ErrorResponse<'static>>)> {
    state
        .inner
        .enable_notification_type(decoded_jwt.macro_user_id, &notification_event_type)
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
