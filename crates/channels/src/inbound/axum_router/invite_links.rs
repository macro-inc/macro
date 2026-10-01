use super::*;

/// Creates a fresh channel invitation that expires in 14 days.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "create_channel_invite_link",
    path = "/channels/{channel_id}/invite-link",
    params(("channel_id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, body = ChannelJoinCodeResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_channel_invite_link_handler<
    S: ChannelService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
) -> Result<Json<ChannelJoinCodeResponse>, ChannelsHandlerErr> {
    Ok(Json(
        state
            .service
            .create_channel_invite_link(access.entity_access_receipt)
            .await?,
    ))
}
