//! Thin authenticated group control routes; all policy remains in MetaService.
use super::*;
use crate::domain::groups::*;
use entity_access::domain::models::{
    AdminParticipantRole, EntityAccessReceipt, OwnerParticipantRole, RequiredPermission,
};

pub(super) fn router<Eas: EntityAccessService, Auth: MacroAuthorizationService>()
-> Router<MessagingRouterState<Eas, Auth>> {
    Router::new()
        .route(
            "/connections/{connection_id}/groups",
            post(create::<Eas, Auth>),
        )
        .route(
            "/channels/{channel_id}/group/retry",
            post(retry::<Eas, Auth>),
        )
        .route(
            "/channels/{channel_id}/group/discard",
            post(discard::<Eas, Auth>),
        )
        .route("/channels/{channel_id}/group/link", get(link::<Eas, Auth>))
        .route(
            "/channels/{channel_id}/group",
            axum::routing::delete(delete::<Eas, Auth>),
        )
        .route(
            "/channels/{channel_id}/group/participants/{participant_id}",
            axum::routing::delete(remove::<Eas, Auth>),
        )
}

fn actor<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> Result<(Uuid, String), ApiError> {
    let channel = access
        .entity()
        .entity_id
        .parse()
        .map_err(|_| MessagingError::Forbidden)?;
    let user = access
        .get_authenticated_user()
        .map_err(|_| MessagingError::Forbidden)?
        .as_ref()
        .to_owned();
    Ok((channel, user))
}

#[utoipa::path(post,path="/meta/connections/{connection_id}/groups",operation_id="meta_create_group",params(("connection_id"=Uuid,Path)),request_body=CreateGroup,responses((status=200,body=GroupSetup)))]
pub(super) async fn create<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateGroup>,
) -> Result<Json<GroupSetup>, ApiError> {
    Ok(Json(
        s.service
            .create_group(
                &a.entity_access_receipt,
                id,
                request,
                send_authority(&headers),
            )
            .await?,
    ))
}

#[utoipa::path(post,path="/meta/channels/{channel_id}/group/retry",operation_id="meta_retry_group",params(("channel_id"=Uuid,Path)),responses((status=200,body=GroupSetup)))]
pub(super) async fn retry<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<OwnerParticipantRole, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
) -> Result<Json<GroupSetup>, ApiError> {
    let (channel, user) = actor(&a.entity_access_receipt)?;
    Ok(Json(
        s.service
            .retry_group(channel, &user, send_authority(&headers))
            .await?,
    ))
}

#[utoipa::path(get,path="/meta/channels/{channel_id}/group/link",operation_id="meta_group_link",params(("channel_id"=Uuid,Path)),responses((status=200,body=GroupInviteLink)))]
pub(super) async fn link<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<MessageWrite, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
) -> Result<Json<GroupInviteLink>, ApiError> {
    let (channel, user) = actor(&a.entity_access_receipt)?;
    Ok(Json(
        s.service
            .group_link(channel, &user, send_authority(&headers))
            .await?,
    ))
}

#[utoipa::path(delete,path="/meta/channels/{channel_id}/group/participants/{participant_id}",operation_id="meta_remove_group_participant",params(("channel_id"=Uuid,Path),("participant_id"=Uuid,Path)),responses((status=200)))]
pub(super) async fn remove<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<AdminParticipantRole, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(ids): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<()>, ApiError> {
    let (channel, user) = actor(&a.entity_access_receipt)?;
    s.service
        .remove_group_participant(channel, &user, ids.1, send_authority(&headers))
        .await?;
    Ok(Json(()))
}

#[utoipa::path(post,path="/meta/channels/{channel_id}/group/discard",operation_id="meta_discard_group_setup",params(("channel_id"=Uuid,Path)),responses((status=200)))]
pub(super) async fn discard<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<OwnerParticipantRole, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
) -> Result<Json<()>, ApiError> {
    let (channel, user) = actor(&a.entity_access_receipt)?;
    s.service
        .discard_group_setup(channel, &user, send_authority(&headers))
        .await?;
    Ok(Json(()))
}

#[utoipa::path(delete,path="/meta/channels/{channel_id}/group",operation_id="meta_delete_group",params(("channel_id"=Uuid,Path)),responses((status=200)))]
pub(super) async fn delete<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<OwnerParticipantRole, Eas, Auth>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
) -> Result<Json<()>, ApiError> {
    let (channel, user) = actor(&a.entity_access_receipt)?;
    s.service
        .delete_group(channel, &user, send_authority(&headers))
        .await?;
    Ok(Json(()))
}
