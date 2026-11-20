//! The authenticated user's own Chat section notification settings.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use notification::domain::channel_settings::ChannelNotificationKind;
use notification::domain::section_settings::{
    ChannelSection, SectionMute, SectionNotificationSettings, SectionNotificationSettingsChange,
    SectionNotificationSettingsError, SectionSettingsWriteError,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use utoipa::ToSchema;

use super::internal_error;
use crate::api::context::{ApiContext, AuthorizationService};

/// One section's settings. They apply to every channel the section holds for
/// the user: a channel notifies for a kind when any of its sections allows
/// it, and its sections mute it only when all of them are muted.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SectionNotificationSettingsResponse {
    pub section: ChannelSection,
    /// Kinds the section does not allow.
    pub disabled: BTreeSet<ChannelNotificationKind>,
    pub mute: SectionMute,
}

impl SectionNotificationSettingsResponse {
    fn new(section: ChannelSection, settings: SectionNotificationSettings) -> Self {
        Self {
            section,
            disabled: settings.disabled,
            mute: settings.mute,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSectionNotificationSettingsResponse {
    /// Every section with settings; any other section allows everything and
    /// is unmuted.
    pub sections: Vec<SectionNotificationSettingsResponse>,
}

/// A change to one section's settings. Kinds the change does not name keep
/// their setting.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSectionNotificationSettingsRequest {
    pub section: ChannelSection,
    /// Kinds to allow.
    #[serde(default)]
    pub enable: BTreeSet<ChannelNotificationKind>,
    /// Kinds to stop allowing.
    #[serde(default)]
    pub disable: BTreeSet<ChannelNotificationKind>,
    /// The new mute. Omit to keep the current one.
    pub mute: Option<SectionMute>,
}

fn update_error(error: SectionNotificationSettingsError) -> Response {
    match error {
        SectionNotificationSettingsError::Write(SectionSettingsWriteError::Repository(error)) => {
            tracing::error!(?error, "unable to update section notification settings");
            internal_error("unable to update section notification settings")
        }
        SectionNotificationSettingsError::Write(SectionSettingsWriteError::UnknownSection) => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                message: "section not found".into(),
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

/// List the authenticated user's Chat sections that have notification settings.
#[utoipa::path(
    get,
    operation_id = "list_section_notification_settings",
    path = "/notification_settings/sections",
    responses(
        (status = 200, body = ListSectionNotificationSettingsResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn list_section_settings(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    let settings = ctx
        .section_settings
        .list(user.authorization.user.macro_user_id, chrono::Utc::now())
        .await
        .map_err(|error| {
            tracing::error!(?error, "unable to list section notification settings");
            internal_error("unable to list section notification settings")
        })?;

    let sections = settings
        .into_iter()
        .map(|(section, settings)| SectionNotificationSettingsResponse::new(section, settings))
        .collect();
    Ok(Json(ListSectionNotificationSettingsResponse { sections }).into_response())
}

/// Change the authenticated user's notification settings for one Chat section.
#[utoipa::path(
    patch,
    operation_id = "update_section_notification_settings",
    path = "/notification_settings/sections",
    request_body = UpdateSectionNotificationSettingsRequest,
    responses(
        (status = 200, body = SectionNotificationSettingsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(section = ?request.section))]
pub async fn update_section_settings(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<UpdateSectionNotificationSettingsRequest>,
) -> Result<Response, Response> {
    let change = SectionNotificationSettingsChange {
        enable: request.enable,
        disable: request.disable,
        mute: request.mute,
    };
    let settings = ctx
        .section_settings
        .update(
            user.authorization.user.macro_user_id,
            request.section,
            change,
            chrono::Utc::now(),
        )
        .await
        .map_err(update_error)?;

    Ok(Json(SectionNotificationSettingsResponse::new(
        request.section,
        settings,
    ))
    .into_response())
}
