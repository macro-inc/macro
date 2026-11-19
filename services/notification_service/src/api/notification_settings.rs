//! The authenticated user's own channel and Chat section notification settings.

pub(crate) mod sections;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, ErrorResponse};
use notification::domain::channel_settings::{
    ChannelKindsChange, ChannelNotificationKind, ChannelNotificationSettings,
    ChannelNotificationSettingsChange, ChannelNotificationSettingsError, ChannelSettingsWriteError,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::api::context::{ApiContext, AuthorizationService};

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/channels", get(list_channel_settings))
        .route(
            "/channels/{channel_id}",
            patch(update_channel_settings).delete(reset_channel_settings),
        )
        .route(
            "/sections",
            get(sections::list_section_settings).patch(sections::update_section_settings),
        )
}

#[derive(Deserialize, IntoParams)]
pub struct ChannelPathParams {
    /// The channel the settings apply to.
    pub channel_id: Uuid,
}

/// One channel's own notification settings.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelNotificationSettingsResponse {
    pub channel_id: Uuid,
    /// The channel's own settings: exactly the kinds it notifies for,
    /// whatever its sections say. `null` follows the sections.
    #[schema(required = true)]
    pub enabled: Option<BTreeSet<ChannelNotificationKind>>,
    /// The channel notifies even when the sections holding it are muted.
    pub overrides_section_mute: bool,
}

impl ChannelNotificationSettingsResponse {
    fn new(channel_id: Uuid, settings: ChannelNotificationSettings) -> Self {
        Self {
            channel_id,
            enabled: settings.enabled,
            overrides_section_mute: settings.overrides_section_mute,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListChannelNotificationSettingsResponse {
    /// Every channel with settings; any other channel follows its sections.
    pub channels: Vec<ChannelNotificationSettingsResponse>,
}

/// A change to one channel's settings. A channel either follows its sections
/// for every kind or has its own setting for all of them.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannelNotificationSettingsRequest {
    /// Give the channel its own settings: exactly these kinds notify,
    /// whatever its sections say. Omit to keep the current kinds.
    pub enabled: Option<BTreeSet<ChannelNotificationKind>>,
    /// Drop the channel's own kinds so it follows its sections again. Can't
    /// be combined with `enabled`.
    #[serde(default)]
    pub inherit: bool,
    /// Keep notifying while the sections holding the channel are muted.
    /// Omit to keep the current value.
    pub overrides_section_mute: Option<bool>,
}

pub(super) fn internal_error(message: &'static str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

fn update_error(error: ChannelNotificationSettingsError) -> Response {
    match error {
        ChannelNotificationSettingsError::Write(ChannelSettingsWriteError::Repository(error)) => {
            tracing::error!(?error, "unable to update channel notification settings");
            internal_error("unable to update channel notification settings")
        }
        ChannelNotificationSettingsError::Write(ChannelSettingsWriteError::UnknownChannel) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "channel not found".into(),
            }),
        )
            .into_response(),
        error => (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: error.to_string().into(),
            }),
        )
            .into_response(),
    }
}

/// List the authenticated user's channels that have notification settings.
#[utoipa::path(
    get,
    operation_id = "list_channel_notification_settings",
    path = "/notification_settings/channels",
    responses(
        (status = 200, body = ListChannelNotificationSettingsResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn list_channel_settings(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    let settings = ctx
        .channel_settings
        .list(user.authorization.user.macro_user_id)
        .await
        .map_err(|error| {
            tracing::error!(?error, "unable to list channel notification settings");
            internal_error("unable to list channel notification settings")
        })?;

    let channels = settings
        .into_iter()
        .map(|(channel_id, settings)| {
            ChannelNotificationSettingsResponse::new(channel_id, settings)
        })
        .collect();
    Ok(Json(ListChannelNotificationSettingsResponse { channels }).into_response())
}

/// Change the authenticated user's notification settings for one channel.
#[utoipa::path(
    patch,
    operation_id = "update_channel_notification_settings",
    path = "/notification_settings/channels/{channel_id}",
    params(ChannelPathParams),
    request_body = UpdateChannelNotificationSettingsRequest,
    responses(
        (status = 200, body = ChannelNotificationSettingsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(channel_id = %channel_id))]
pub async fn update_channel_settings(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(ChannelPathParams { channel_id }): Path<ChannelPathParams>,
    Json(request): Json<UpdateChannelNotificationSettingsRequest>,
) -> Result<Response, Response> {
    let kinds = match (request.enabled, request.inherit) {
        (Some(_), true) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "set the channel's own kinds or inherit them, not both".into(),
                }),
            )
                .into_response());
        }
        (Some(enabled), false) => ChannelKindsChange::Set(enabled),
        (None, true) => ChannelKindsChange::Inherit,
        (None, false) => ChannelKindsChange::Keep,
    };
    let change = ChannelNotificationSettingsChange {
        kinds,
        overrides_section_mute: request.overrides_section_mute,
    };
    let settings = ctx
        .channel_settings
        .update(user.authorization.user.macro_user_id, channel_id, change)
        .await
        .map_err(update_error)?;

    Ok(Json(ChannelNotificationSettingsResponse::new(
        channel_id, settings,
    ))
    .into_response())
}

/// Remove the authenticated user's settings for one channel, including a
/// legacy mentions-only preference, so it follows its sections again.
#[utoipa::path(
    delete,
    operation_id = "reset_channel_notification_settings",
    path = "/notification_settings/channels/{channel_id}",
    params(ChannelPathParams),
    responses(
        (status = 200, body = EmptyResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(channel_id = %channel_id))]
pub async fn reset_channel_settings(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(ChannelPathParams { channel_id }): Path<ChannelPathParams>,
) -> Result<Response, Response> {
    ctx.channel_settings
        .reset(user.authorization.user.macro_user_id, channel_id)
        .await
        .map_err(|error| {
            tracing::error!(?error, "unable to reset channel notification settings");
            internal_error("unable to reset channel notification settings")
        })?;

    Ok(Json(EmptyResponse {}).into_response())
}
