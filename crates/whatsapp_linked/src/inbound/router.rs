//! Thin HTTP adapter: authenticated owners and WhatsApp group receipts flow to
//! [`LinkedService`]. Mounted by DSS under `/meta/linked`.

use crate::domain::{models::*, service::LinkedService, timeline::*};
use axum::extract::Query;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::{
    domain::ports::EntityAccessService, inbound::axum_extractors::WhatsAppGroupAccessLevelExtractor,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    MacroUserAuthentication, UserOnly,
};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Capabilities supplied by DSS.
pub struct LinkedRouterState<Eas, Auth> {
    /// Use cases.
    pub service: Arc<LinkedService>,
    /// Standard group receipt provider.
    pub entity_access_service: Arc<Eas>,
    /// Standard authentication provider.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Eas, Auth> Clone for LinkedRouterState<Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Eas, Auth> FromRef<LinkedRouterState<Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &LinkedRouterState<Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Eas, Auth> FromRef<LinkedRouterState<Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &LinkedRouterState<Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Domain errors as `{code, message}` JSON.
pub struct ApiError(LinkedError);

impl From<rootcause::Report<LinkedError>> for ApiError {
    fn from(error: rootcause::Report<LinkedError>) -> Self {
        if matches!(
            error.current_context(),
            LinkedError::Unavailable | LinkedError::Fenced
        ) {
            tracing::error!(error = ?error, "WhatsApp linked request failed");
        }
        Self(error.current_context().clone())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            LinkedError::Invalid(_) => StatusCode::BAD_REQUEST,
            LinkedError::Forbidden => StatusCode::FORBIDDEN,
            LinkedError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            LinkedError::NotFound | LinkedError::ConfigurationRequired => StatusCode::NOT_FOUND,
            LinkedError::Conflict
            | LinkedError::IdentityConflict
            | LinkedError::Disconnected
            | LinkedError::SendExpired => StatusCode::CONFLICT,
            LinkedError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            LinkedError::Fenced => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let mut response = (
            status,
            Json(serde_json::json!({ "code": self.0.code(), "message": self.0.to_string() })),
        )
            .into_response();
        if matches!(self.0, LinkedError::RateLimited) {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        response
    }
}

/// Explicit pairing intent; replacement is a separate deliberate action.
#[derive(Deserialize, utoipa::ToSchema)]
#[schema(as = LinkedConnect)]
pub struct Connect {
    /// Replace the retained identity with a different WhatsApp account.
    #[serde(default)]
    pub replace: bool,
}

/// The consent generation the owner deliberately disconnects.
#[derive(Deserialize, Serialize, utoipa::ToSchema)]
#[schema(as = LinkedDisconnectRequest)]
pub struct DisconnectRequest {
    /// Fences retries against a later reconnect or replacement.
    pub authorization_generation: i64,
}

fn authority(headers: &HeaderMap, user: &MacroUserAuthentication) -> SendAuthority {
    if user.is_macro_api_token || headers.contains_key(macro_authorization::USER_API_KEY_HEADER) {
        SendAuthority::UserApiToken
    } else if user.agent_id.is_some() {
        SendAuthority::Automation
    } else {
        SendAuthority::Human
    }
}

/// Build the routes. Pairing codes and send drafts are never cached.
pub fn router<Eas, Auth, S>(state: LinkedRouterState<Eas, Auth>) -> Router<S>
where
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/configuration", get(configuration::<Eas, Auth>))
        .route("/account", get(account::<Eas, Auth>))
        .route("/connect", post(connect::<Eas, Auth>))
        .route("/disconnect", post(disconnect::<Eas, Auth>))
        .route(
            "/pairing/{id}",
            get(pairing::<Eas, Auth>).delete(cancel::<Eas, Auth>),
        )
        .route("/groups", get(groups::<Eas, Auth>))
        .route("/chats", get(chats::<Eas, Auth>))
        .route("/groups/adopt", post(adopt::<Eas, Auth>))
        .route("/whatsapp-groups", get(adopted_groups::<Eas, Auth>))
        .route(
            "/whatsapp-groups/{group_id}",
            get(group::<Eas, Auth>).delete(detach::<Eas, Auth>),
        )
        .route(
            "/whatsapp-groups/{group_id}/messages",
            get(messages::<Eas, Auth>),
        )
        .route(
            "/whatsapp-groups/{group_id}/read",
            post(mark_read::<Eas, Auth>),
        )
        .route(
            "/whatsapp-groups/{group_id}/permissions",
            get(permissions::<Eas, Auth>).patch(update_permissions::<Eas, Auth>),
        )
        .route("/pairing/{id}/passkey", post(passkey::<Eas, Auth>))
        .route(
            "/whatsapp-groups/{group_id}/sends",
            get(open_sends::<Eas, Auth>).post(reply::<Eas, Auth>),
        )
        .route(
            "/whatsapp-groups/{group_id}/attachments",
            post(upload::<Eas, Auth>).layer(DefaultBodyLimit::max(MEDIA_LIMIT_BYTES + 64 * 1024)),
        )
        .route(
            "/whatsapp-groups/{group_id}/delivery",
            post(delivery::<Eas, Auth>),
        )
        .route(
            "/whatsapp-groups/{group_id}/messages/attachments",
            post(message_attachments::<Eas, Auth>),
        )
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                let headers = response.headers_mut();
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                headers.insert(
                    header::REFERRER_POLICY,
                    HeaderValue::from_static("no-referrer"),
                );
                response
            },
        ))
        .with_state(state)
}

/// Server rollout switches.
#[utoipa::path(get, path = "/meta/linked/configuration", operation_id = "linked_configuration", responses((status = 200, body = Features)))]
pub async fn configuration<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Json<Features> {
    Json(state.service.features())
}

/// The caller's own account.
#[utoipa::path(get, path = "/meta/linked/account", operation_id = "linked_account", responses((status = 200, body = AccountView)))]
pub async fn account<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<AccountView>, ApiError> {
    Ok(Json(AccountView {
        account: state
            .service
            .account(auth.authorization.macro_user_id.as_ref())
            .await?,
    }))
}

/// Start or resume the caller's pairing transaction.
#[utoipa::path(post, path = "/meta/linked/connect", operation_id = "linked_connect", request_body = Connect, responses((status = 200, body = Pairing)))]
pub async fn connect<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Json(body): Json<Connect>,
) -> Result<Json<Pairing>, ApiError> {
    Ok(Json(
        state
            .service
            .connect(
                auth.authorization.macro_user_id.as_ref(),
                body.replace,
                authority(&headers, &auth.authorization),
            )
            .await?,
    ))
}

/// Poll the caller's pairing transaction, including its current QR code.
#[utoipa::path(get, path = "/meta/linked/pairing/{id}", operation_id = "linked_pairing", params(("id" = Uuid, Path)), responses((status = 200, body = PairState)))]
pub async fn pairing<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<PairState>, ApiError> {
    Ok(Json(
        state
            .service
            .pair_state(
                auth.authorization.macro_user_id.as_ref(),
                id,
                authority(&headers, &auth.authorization),
            )
            .await?,
    ))
}

/// Cancel the caller's pairing transaction.
#[utoipa::path(delete, path = "/meta/linked/pairing/{id}", operation_id = "linked_cancel_pairing", params(("id" = Uuid, Path)), responses((status = 204)))]
pub async fn cancel<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .cancel(
            auth.authorization.macro_user_id.as_ref(),
            id,
            authority(&headers, &auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Forward the owner's WebAuthn assertion to the pairing replica.
#[utoipa::path(post, path = "/meta/linked/pairing/{id}/passkey", operation_id = "linked_passkey", params(("id" = Uuid, Path)), request_body = Object, responses((status = 204)))]
pub async fn passkey<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .passkey(
            auth.authorization.macro_user_id.as_ref(),
            id,
            &body,
            authority(&headers, &auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Multipart body of the attachments route.
#[derive(utoipa::ToSchema)]
#[schema(as = LinkedUploadRequest)]
pub struct UploadRequest {
    /// One supported image, audio, video, PDF or text file.
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
}

/// Stage one attachment for a later media reply in this group.
#[utoipa::path(post, path = "/meta/linked/whatsapp-groups/{group_id}/attachments", operation_id = "linked_upload", params(("group_id" = Uuid, Path)), request_body(content = UploadRequest, content_type = "multipart/form-data"), responses((status = 200, body = UploadedAttachment)))]
pub async fn upload<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    headers: HeaderMap,
    mut input: Multipart,
) -> Result<Json<UploadedAttachment>, ApiError> {
    let invalid = |message| ApiError(LinkedError::Invalid(message));
    let field = input
        .next_field()
        .await
        .map_err(|_| invalid("invalid attachment"))?
        .ok_or_else(|| invalid("choose a file"))?;
    if field.name() != Some("file") {
        return Err(invalid("one file field is required"));
    }
    let filename = field
        .file_name()
        .ok_or_else(|| invalid("a filename is required"))?
        .to_owned();
    let mime = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_owned();
    let bytes = field
        .bytes()
        .await
        .map_err(|_| invalid("attachment exceeds the size limit"))?;
    Ok(Json(
        state
            .service
            .upload_attachment(
                &access.entity_access_receipt,
                &filename,
                &mime,
                &bytes,
                authority(&headers, &auth.authorization),
            )
            .await?,
    ))
}

/// End the caller's observation consent.
#[utoipa::path(post, path = "/meta/linked/disconnect", operation_id = "linked_disconnect", request_body = DisconnectRequest, responses((status = 200, body = Disconnect)))]
pub async fn disconnect<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Json(body): Json<DisconnectRequest>,
) -> Result<Json<Disconnect>, ApiError> {
    Ok(Json(
        state
            .service
            .disconnect(
                auth.authorization.macro_user_id.as_ref(),
                body.authorization_generation,
                authority(&headers, &auth.authorization),
            )
            .await?,
    ))
}

/// Groups the caller's account has joined.
#[utoipa::path(get, path = "/meta/linked/groups", operation_id = "linked_groups", responses((status = 200, body = Vec<GroupInfo>)))]
pub async fn groups<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<Vec<GroupInfo>>, ApiError> {
    Ok(Json(
        state
            .service
            .groups(auth.authorization.macro_user_id.as_ref())
            .await?,
    ))
}

/// The caller's WhatsApp chat list (groups and direct chats), newest
/// activity first, with what can be added to Macro.
#[utoipa::path(get, path = "/meta/linked/chats", operation_id = "linked_chats", responses((status = 200, body = ChatList)))]
pub async fn chats<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<ChatList>, ApiError> {
    Ok(Json(
        state
            .service
            .chats(auth.authorization.macro_user_id.as_ref())
            .await?,
    ))
}

/// Adopt one of the caller's groups into a standalone group entity.
#[utoipa::path(post, path = "/meta/linked/groups/adopt", operation_id = "linked_adopt", request_body = AdoptGroup, responses((status = 200, body = AdoptedGroup)))]
pub async fn adopt<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Json(body): Json<AdoptGroup>,
) -> Result<Json<AdoptedGroup>, ApiError> {
    let binding = state
        .service
        .adopt(
            auth.authorization.macro_user_id.as_ref(),
            &body,
            authority(&headers, &auth.authorization),
        )
        .await?;
    Ok(Json(AdoptedGroup {
        group_id: binding.id,
    }))
}

/// Linked metadata for a group the caller can read.
#[utoipa::path(get, path = "/meta/linked/whatsapp-groups/{group_id}", operation_id = "whatsapp_group", params(("group_id" = Uuid, Path)), responses((status = 200, body = WhatsAppGroupDetail)))]
pub async fn group<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<WhatsAppGroupDetail>, ApiError> {
    Ok(Json(
        state
            .service
            .group_detail(&access.entity_access_receipt)
            .await?,
    ))
}

/// Send to WhatsApp from the caller's own account (one request per second per user).
#[utoipa::path(post, path = "/meta/linked/whatsapp-groups/{group_id}/sends", operation_id = "linked_reply", params(("group_id" = Uuid, Path)), request_body = SendReply, responses((status = 200, body = SendProgress), (status = 429, description = "One send request per second per user; Retry-After: 1")))]
pub async fn reply<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    headers: HeaderMap,
    Json(body): Json<SendReply>,
) -> Result<Json<SendProgress>, ApiError> {
    Ok(Json(
        state
            .service
            .send_reply(
                &access.entity_access_receipt,
                &body,
                authority(&headers, &auth.authorization),
            )
            .await?,
    ))
}

/// The caller's send progress for intents or group messages.
#[utoipa::path(post, path = "/meta/linked/whatsapp-groups/{group_id}/delivery", operation_id = "linked_delivery", params(("group_id" = Uuid, Path)), request_body = Vec<Uuid>, responses((status = 200, body = Vec<SendProgress>)))]
pub async fn delivery<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        state
            .service
            .delivery(&access.entity_access_receipt, &ids)
            .await?,
    ))
}

/// Attachment states of linked messages, by group message id (at most 100).
#[utoipa::path(post, path = "/meta/linked/whatsapp-groups/{group_id}/messages/attachments", operation_id = "linked_message_attachments", params(("group_id" = Uuid, Path)), request_body = Vec<Uuid>, responses((status = 200, body = Vec<MessageAttachments>)))]
pub async fn message_attachments<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<MessageAttachments>>, ApiError> {
    Ok(Json(
        state
            .service
            .message_attachments(&access.entity_access_receipt, &ids)
            .await?,
    ))
}

/// Stop syncing the group, locally.
#[utoipa::path(delete, path = "/meta/linked/whatsapp-groups/{group_id}", operation_id = "linked_detach", params(("group_id" = Uuid, Path)), responses((status = 204)))]
pub async fn detach<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(group_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .detach(
            auth.authorization.macro_user_id.as_ref(),
            group_id,
            authority(&headers, &auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod test;

/// List adopted groups the caller can view, including without WhatsApp.
#[utoipa::path(get,path="/meta/linked/whatsapp-groups",operation_id="whatsapp_groups",responses((status=200,body=Vec<WhatsAppGroupSummary>)))]
pub async fn adopted_groups<Eas, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<Vec<WhatsAppGroupSummary>>, ApiError> {
    Ok(Json(
        state
            .service
            .adopted_groups(auth.authorization.macro_user_id.as_ref())
            .await?,
    ))
}
/// Stable timeline pagination.
#[derive(Deserialize, utoipa::IntoParams)]
pub struct TimelineQuery {
    /// Last message id in the previous page.
    pub before: Option<Uuid>,
    /// Page size, 1 through 100.
    pub limit: Option<i64>,
}
/// Newest-first timeline through ordinary view access.
#[utoipa::path(get,path="/meta/linked/whatsapp-groups/{group_id}/messages",operation_id="whatsapp_group_messages",params(("group_id"=Uuid,Path),TimelineQuery),responses((status=200,body=WhatsAppGroupMessages)))]
pub async fn messages<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Query(query): Query<TimelineQuery>,
) -> Result<Json<WhatsAppGroupMessages>, ApiError> {
    Ok(Json(
        state
            .service
            .messages(
                &access.entity_access_receipt,
                query.before,
                query.limit.unwrap_or(50),
            )
            .await?,
    ))
}
/// Advance this viewer's read position.
#[utoipa::path(post,path="/meta/linked/whatsapp-groups/{group_id}/read",operation_id="whatsapp_group_read",params(("group_id"=Uuid,Path)),request_body=MarkRead,responses((status=204)))]
pub async fn mark_read<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(body): Json<MarkRead>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .mark_read(&access.entity_access_receipt, body.message_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
/// Caller-owned pending, failed and uncertain sends.
#[utoipa::path(get,path="/meta/linked/whatsapp-groups/{group_id}/sends",operation_id="whatsapp_group_sends",params(("group_id"=Uuid,Path)),responses((status=200,body=Vec<SendProgress>)))]
pub async fn open_sends<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        state
            .service
            .open_sends(&access.entity_access_receipt)
            .await?,
    ))
}
/// Generic Share dialog policy.
#[utoipa::path(get,path="/meta/linked/whatsapp-groups/{group_id}/permissions",operation_id="whatsapp_group_permissions",params(("group_id"=Uuid,Path)),responses((status=200,body=SharePermissionV2)))]
pub async fn permissions<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<SharePermissionV2>, ApiError> {
    Ok(Json(
        state
            .service
            .permissions(&access.entity_access_receipt)
            .await?,
    ))
}
/// Actual owner updates link and team sharing.
#[utoipa::path(patch,path="/meta/linked/whatsapp-groups/{group_id}/permissions",operation_id="whatsapp_group_update_permissions",params(("group_id"=Uuid,Path)),request_body=UpdateSharePermissionRequestV2,responses((status=204)))]
pub async fn update_permissions<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<LinkedRouterState<Eas, Auth>>,
    access: WhatsAppGroupAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(body): Json<UpdateSharePermissionRequestV2>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .update_permissions(&access.entity_access_receipt, &body)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
