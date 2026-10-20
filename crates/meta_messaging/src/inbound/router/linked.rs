//! Thin owner/native-receipt HTTP adapter for personal linked devices.
use super::*;
use crate::domain::linked::{models::*, service::LinkedService};
use crate::domain::replies::{ReplyCapabilities, ReplyEligibility};
use serde::Serialize;

fn linked<E, A>(s: &MessagingRouterState<E, A>) -> Result<&LinkedService, ApiError> {
    s.linked
        .as_deref()
        .ok_or_else(|| MessagingError::ConfigurationRequired.into())
}
/// Explicit pairing intent; replacement requires a separate deliberate UI action.
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as = LinkedConnect)]
pub struct Connect {
    /// Explicitly replace the retained personal identity.
    #[serde(default)]
    pub replace: bool,
}
/// Normal native composer metadata for the authenticated viewer.
#[derive(Serialize, utoipa::ToSchema)]
#[schema(as = LinkedChannelView)]
pub struct ChannelView {
    /// Last reconciled WhatsApp roster, separate from native audience grants.
    pub roster: Option<GroupInfo>,
    /// Own personal account; never a colleague's identity.
    pub account: Account,
    /// Workspace/native binding.
    pub binding: Binding,
    /// Implemented native composer operations.
    pub capabilities: ReplyCapabilities,
    /// Current server eligibility.
    pub eligibility: ReplyEligibility,
    /// Current native posting authority.
    pub can_reply: bool,
    /// Existing durable send results.
    pub sends: Vec<SendProgress>,
}

/// Owner-scoped account state, including the not-connected state.
#[derive(Serialize, utoipa::ToSchema)]
#[schema(as=LinkedAccountView)]
pub struct AccountView {
    /// The caller's retained account, when one exists.
    pub account: Option<Account>,
}

/// The account consent the owner deliberately disconnects.
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as=LinkedDisconnectRequest)]
pub struct DisconnectRequest {
    /// Fences retries against a subsequent replacement or reconnect.
    pub authorization_generation: i64,
}
/// Local disconnect and the independently observed remote unlink result.
#[derive(Serialize, utoipa::ToSchema)]
#[schema(as=LinkedDisconnect)]
pub struct Disconnect {
    /// True only when WhatsApp confirmed unlinking this endpoint.
    pub remote_unlink_confirmed: bool,
}

pub(super) fn router<E: EntityAccessService, A: MacroAuthorizationService>()
-> Router<MessagingRouterState<E, A>> {
    Router::new()
        .route(
            "/linked/channels/{channel_id}/attachments",
            post(upload::<E, A>).layer(DefaultBodyLimit::max(32 * 1024 * 1024 + 65536)),
        )
        .route("/linked/channels/{channel_id}/access", post(grant::<E, A>))
        .route(
            "/linked/channels/{channel_id}/owner",
            post(transfer::<E, A>),
        )
        .route("/linked/configuration", get(configuration::<E, A>))
        .route("/linked/account", get(account::<E, A>))
        .route("/linked/connect", post(connect::<E, A>))
        .route("/linked/disconnect", post(disconnect::<E, A>))
        .route(
            "/linked/pairing/{id}",
            get(pair::<E, A>).delete(cancel::<E, A>),
        )
        .route("/linked/pairing/{id}/passkey", post(passkey::<E, A>))
        .route("/linked/pairing/{id}/confirm", post(confirm::<E, A>))
        .route("/linked/groups", get(groups::<E, A>).post(adopt::<E, A>))
        .route("/linked/channels/{channel_id}", get(channel::<E, A>))
        .route("/linked/channels/{channel_id}/detach", post(detach::<E, A>))
        .route("/linked/channels/{channel_id}/replies", post(reply::<E, A>))
        .route(
            "/linked/channels/{channel_id}/delivery",
            post(delivery::<E, A>),
        )
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("no-store"),
                );
                response.headers_mut().insert(
                    axum::http::header::REFERRER_POLICY,
                    axum::http::HeaderValue::from_static("no-referrer"),
                );
                response
            },
        ))
}
#[utoipa::path(get,path="/meta/linked/configuration",operation_id="linked_configuration",responses((status=200,body=Features)))]
async fn configuration<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    _: MacroAuthorizationExtractor<A, UserOnly>,
) -> Json<Features> {
    Json(
        s.linked
            .as_ref()
            .map(|l| l.features.clone())
            .unwrap_or_default(),
    )
}
#[utoipa::path(get,path="/meta/linked/account",operation_id="linked_account",responses((status=200,body=AccountView)))]
async fn account<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Json<AccountView>, ApiError> {
    Ok(Json(AccountView {
        account: linked(&s)?
            .account(auth.authorization.macro_user_id.as_ref())
            .await?,
    }))
}
#[utoipa::path(post,path="/meta/linked/connect",operation_id="linked_connect",request_body=Connect,responses((status=200,body=Pairing)))]
async fn connect<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    headers: HeaderMap,
    Json(body): Json<Connect>,
) -> Result<Json<Pairing>, ApiError> {
    Ok(Json(
        linked(&s)?
            .connect(
                auth.authorization.macro_user_id.as_ref(),
                body.replace,
                send_authority(&headers),
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/meta/linked/pairing/{id}",operation_id="linked_pairing",params(("id"=Uuid,Path)),responses((status=200,body=PairState)))]
async fn pair<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<Json<PairState>, ApiError> {
    Ok(Json(
        linked(&s)?
            .pair_state(auth.authorization.macro_user_id.as_ref(), id)
            .await?,
    ))
}
#[utoipa::path(delete,path="/meta/linked/pairing/{id}",operation_id="linked_cancel_pairing",params(("id"=Uuid,Path)),responses((status=204)))]
async fn cancel<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .cancel(auth.authorization.macro_user_id.as_ref(), id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/meta/linked/pairing/{id}/passkey",operation_id="linked_passkey",params(("id"=Uuid,Path)),request_body=serde_json::Value,responses((status=204)))]
async fn passkey<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .passkey(
            auth.authorization.macro_user_id.as_ref(),
            id,
            &body,
            send_authority(&headers),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/meta/linked/pairing/{id}/confirm",operation_id="linked_confirm_pairing",params(("id"=Uuid,Path)),responses((status=204)))]
async fn confirm<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .confirm(
            auth.authorization.macro_user_id.as_ref(),
            id,
            send_authority(&headers),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/meta/linked/disconnect",operation_id="linked_disconnect",request_body=DisconnectRequest,responses((status=200,body=Disconnect)))]
async fn disconnect<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    headers: HeaderMap,
    Json(request): Json<DisconnectRequest>,
) -> Result<Json<Disconnect>, ApiError> {
    Ok(Json(Disconnect {
        remote_unlink_confirmed: linked(&s)?
            .disconnect(
                auth.authorization.macro_user_id.as_ref(),
                request.authorization_generation,
                send_authority(&headers),
            )
            .await?,
    }))
}
#[utoipa::path(get,path="/meta/linked/groups",operation_id="linked_groups",responses((status=200,body=Vec<GroupInfo>)))]
async fn groups<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
) -> Result<Json<Vec<GroupInfo>>, ApiError> {
    Ok(Json(
        linked(&s)?
            .groups(auth.authorization.macro_user_id.as_ref())
            .await?,
    ))
}
#[utoipa::path(post,path="/meta/linked/groups",operation_id="linked_adopt",request_body=AdoptGroup,responses((status=200,body=Binding)))]
async fn adopt<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    headers: HeaderMap,
    Json(body): Json<AdoptGroup>,
) -> Result<Json<Binding>, ApiError> {
    Ok(Json(
        linked(&s)?
            .adopt(
                auth.authorization.macro_user_id.as_ref(),
                &body,
                send_authority(&headers),
            )
            .await?,
    ))
}
#[utoipa::path(get,path="/meta/linked/channels/{channel_id}",operation_id="linked_channel",params(("channel_id"=Uuid,Path)),responses((status=200,body=ChannelView)))]
async fn channel<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    a: ChannelAccessLevelExtractor<MessageView, E, A>,
    headers: HeaderMap,
) -> Result<Json<ChannelView>, ApiError> {
    let service = linked(&s)?;
    let view = service
        .messaging
        .conversation_view(&a.entity_access_receipt, send_authority(&headers))
        .await?
        .ok_or(MessagingError::NotFound)?;
    let account = service
        .account(auth.authorization.macro_user_id.as_ref())
        .await?
        .ok_or(MessagingError::Disconnected)?;
    let binding = service
        .repository
        .binding(view.conversation.channel_id)
        .await?
        .ok_or(MessagingError::NotFound)?;
    Ok(Json(ChannelView {
        roster: service
            .repository
            .roster(view.conversation.channel_id)
            .await?,
        account,
        binding,
        capabilities: view.capabilities,
        eligibility: view.eligibility,
        can_reply: view.can_reply,
        sends: view.sends,
    }))
}
#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/replies",operation_id="linked_reply",params(("channel_id"=Uuid,Path)),request_body=SendReply,responses((status=200,body=SendProgress)))]
async fn reply<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    _: MacroAuthorizationExtractor<A, UserOnly>,
    a: ChannelAccessLevelExtractor<MessageWrite, E, A>,
    headers: HeaderMap,
    Json(body): Json<SendReply>,
) -> Result<Json<SendProgress>, ApiError> {
    Ok(Json(
        linked(&s)?
            .messaging
            .send_reply(&a.entity_access_receipt, body, send_authority(&headers))
            .await?,
    ))
}
#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/delivery",operation_id="linked_delivery",params(("channel_id"=Uuid,Path)),request_body=Vec<Uuid>,responses((status=200,body=Vec<SendProgress>)))]
async fn delivery<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    a: ChannelAccessLevelExtractor<MessageView, E, A>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        linked(&s)?
            .messaging
            .message_delivery(&a.entity_access_receipt, &ids)
            .await?,
    ))
}
#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/detach",operation_id="linked_detach",params(("channel_id"=Uuid,Path)),responses((status=204)))]
async fn detach<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .detach(
            auth.authorization.macro_user_id.as_ref(),
            channel,
            send_authority(&headers),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/attachments",operation_id="linked_upload",params(("channel_id"=Uuid,Path)),request_body(content=UploadRequest,content_type="multipart/form-data"),responses((status=200,body=UploadedAttachment)))]
async fn upload<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    _: MacroAuthorizationExtractor<A, UserOnly>,
    a: ChannelAccessLevelExtractor<MessageWrite, E, A>,
    mut input: Multipart,
) -> Result<Json<UploadedAttachment>, ApiError> {
    let field = input
        .next_field()
        .await
        .map_err(|_| MessagingError::Invalid("invalid attachment"))?
        .ok_or(MessagingError::Invalid("choose a file"))?;
    if field.name() != Some("file") {
        return Err(MessagingError::Invalid("one file is required").into());
    }
    let filename = field
        .file_name()
        .ok_or(MessagingError::Invalid("filename is required"))?
        .to_owned();
    let mime = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_owned();
    let bytes = field
        .bytes()
        .await
        .map_err(|_| MessagingError::Invalid("attachment exceeds supported limit"))?
        .to_vec();
    Ok(Json(
        linked(&s)?
            .messaging
            .upload_attachment(
                &a.entity_access_receipt,
                crate::domain::ports::MediaBytes {
                    filename,
                    mime_type: mime,
                    bytes,
                },
            )
            .await?,
    ))
}

#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/access",operation_id="linked_grant_access",params(("channel_id"=Uuid,Path)),request_body=Vec<String>,responses((status=204)))]
async fn grant<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel): Path<Uuid>,
    headers: HeaderMap,
    Json(users): Json<Vec<String>>,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .grant(
            auth.authorization.macro_user_id.as_ref(),
            channel,
            &users,
            send_authority(&headers),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post,path="/meta/linked/channels/{channel_id}/owner",operation_id="linked_transfer_owner",params(("channel_id"=Uuid,Path)),request_body=String,responses((status=204)))]
async fn transfer<E: EntityAccessService, A: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<E, A>>,
    auth: MacroAuthorizationExtractor<A, UserOnly>,
    Path(channel): Path<Uuid>,
    headers: HeaderMap,
    Json(owner): Json<String>,
) -> Result<StatusCode, ApiError> {
    linked(&s)?
        .transfer_owner(
            auth.authorization.macro_user_id.as_ref(),
            channel,
            &owner,
            send_authority(&headers),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
