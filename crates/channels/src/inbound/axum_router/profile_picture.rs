use super::*;

/// Replace a channel's picture, or remove it by sending a null file id.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct SetChannelPictureRequest {
    /// Static image file id; null restores the default channel icon.
    pub profile_picture_id: Option<Uuid>,
}

/// Set a channel or group chat profile picture. Requires rename permission.
#[utoipa::path(
    put,
    path = "/channels/{channel_id}/profile_picture",
    operation_id = "set_channel_picture",
    params(("channel_id" = Uuid, Path, description = "Channel ID")),
    request_body = SetChannelPictureRequest,
    responses(
        (status = 204, description = "Picture updated"),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn set_channel_picture_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc, Auth>,
    Json(request): Json<SetChannelPictureRequest>,
) -> Result<StatusCode, ChannelsHandlerErr> {
    state
        .service
        .set_channel_picture(access.entity_access_receipt, request.profile_picture_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
