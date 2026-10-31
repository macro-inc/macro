//! Thin HTTP adapter: authenticated people and external chat receipts flow
//! to [`ExternalChatService`]. DSS mounts [`external_chats_router`] at
//! `/external-chats` (any provider's added chats); each provider mounts its
//! own routes (WhatsApp: `/whatsapp`), sharing [`ApiError`], [`authority`]
//! and [`no_store`]. The OpenAPI tag keeps the routes' original module name,
//! which the generated clients group by.

use crate::domain::{models::*, ports::ChatProvider, service::ExternalChatService, timeline::*};
use axum::extract::Query;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::domain::models::{OwnerAccessLevel, ViewAccessLevel};
use entity_access::{
    domain::ports::EntityAccessService, inbound::axum_extractors::ExternalChatAccessLevelExtractor,
};
use macro_authorization::{
    CredentialOrigin, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, MacroUserAuthentication, UserOnly,
};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

/// Capabilities supplied by DSS.
pub struct ExternalChatRouterState<P, Eas, Auth> {
    /// Use cases.
    pub service: Arc<ExternalChatService<P>>,
    /// Standard chat receipt provider.
    pub entity_access_service: Arc<Eas>,
    /// Standard authentication provider.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<P, Eas, Auth> Clone for ExternalChatRouterState<P, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<P, Eas, Auth> FromRef<ExternalChatRouterState<P, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &ExternalChatRouterState<P, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<P, Eas, Auth> FromRef<ExternalChatRouterState<P, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ExternalChatRouterState<P, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Domain errors as `{code, message}` JSON.
pub struct ApiError(ExternalChatError);

impl From<rootcause::Report<ExternalChatError>> for ApiError {
    fn from(error: rootcause::Report<ExternalChatError>) -> Self {
        if matches!(
            error.current_context(),
            ExternalChatError::Unavailable
                | ExternalChatError::Fenced
                | ExternalChatError::Internal
        ) {
            tracing::error!(error = ?error, "WhatsApp linked request failed");
        }
        Self(error.current_context().clone())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            ExternalChatError::Invalid(_) | ExternalChatError::CannotAdd(_) => {
                StatusCode::BAD_REQUEST
            }
            ExternalChatError::Forbidden => StatusCode::FORBIDDEN,
            ExternalChatError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            ExternalChatError::NotFound => StatusCode::NOT_FOUND,
            ExternalChatError::Conflict
            | ExternalChatError::Disconnected
            | ExternalChatError::SendExpired => StatusCode::CONFLICT,
            ExternalChatError::Unavailable | ExternalChatError::Backlogged => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            ExternalChatError::Fenced | ExternalChatError::Internal => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let mut response = (
            status,
            Json(serde_json::json!({ "code": self.0.code(), "message": self.0.to_string() })),
        )
            .into_response();
        if matches!(self.0, ExternalChatError::RateLimited) {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        }
        response
    }
}

/// Who is acting, from how the caller authenticated.
pub fn authority(user: &MacroUserAuthentication) -> SendAuthority {
    match user.origin {
        CredentialOrigin::MacroApiJwt | CredentialOrigin::UserApiKey => SendAuthority::UserApiToken,
        CredentialOrigin::Session if user.agent_id.is_none() => SendAuthority::Human,
        CredentialOrigin::Session
        | CredentialOrigin::Bot
        | CredentialOrigin::Harness
        | CredentialOrigin::Internal => SendAuthority::Automation,
    }
}

/// Pairing codes and send drafts are never cached.
pub fn no_store<S: Clone + Send + Sync + 'static>(router: Router<S>) -> Router<S> {
    router.layer(axum::middleware::map_response(
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
}

/// Added chats of any provider, under `/external-chats`.
pub fn external_chats_router<P, Eas, Auth, S>(
    state: ExternalChatRouterState<P, Eas, Auth>,
) -> Router<S>
where
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    no_store(
        Router::new()
            .route("/", get(list::<P, Eas, Auth>).post(add::<P, Eas, Auth>))
            .route(
                "/{chat_id}",
                get(chat::<P, Eas, Auth>).delete(remove::<P, Eas, Auth>),
            )
            .route("/{chat_id}/messages", get(messages::<P, Eas, Auth>))
            .route(
                "/{chat_id}/messages/{message_id}",
                get(message::<P, Eas, Auth>),
            )
            .route(
                "/{chat_id}/messages/attachments",
                post(message_attachments::<P, Eas, Auth>),
            )
            .route("/{chat_id}/read", post(mark_read::<P, Eas, Auth>))
            .route(
                "/{chat_id}/permissions",
                get(permissions::<P, Eas, Auth>).patch(update_permissions::<P, Eas, Auth>),
            )
            .route(
                "/{chat_id}/sends",
                get(open_sends::<P, Eas, Auth>).post(send::<P, Eas, Auth>),
            )
            .route(
                "/{chat_id}/attachments",
                post(upload::<P, Eas, Auth>)
                    .layer(DefaultBodyLimit::max(MEDIA_LIMIT_BYTES + 64 * 1024)),
            )
            .route("/{chat_id}/delivery", post(delivery::<P, Eas, Auth>)),
    )
    .with_state(state)
}

/// List external chats the caller can view, including without a provider account.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats", operation_id = "external_chats", responses((status = 200, body = Vec<ExternalChatSummary>)))]
pub async fn list<P: ChatProvider, Eas, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<Vec<ExternalChatSummary>>, ApiError> {
    Ok(Json(
        state
            .service
            .list(&auth.authorization.macro_user_id)
            .await?,
    ))
}

/// Add one of the caller's provider chats as their own external chat.
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats", operation_id = "external_chat_add", request_body = AddChat, responses((status = 200, body = AddedChat)))]
pub async fn add<P: ChatProvider, Eas, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(body): Json<AddChat>,
) -> Result<Json<AddedChat>, ApiError> {
    let chat = state
        .service
        .add(
            &auth.authorization.macro_user_id,
            &body,
            authority(&auth.authorization),
        )
        .await?;
    Ok(Json(AddedChat { chat_id: chat.id }))
}

/// An external chat the caller can read.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}", operation_id = "external_chat", params(("chat_id" = Uuid, Path)), responses((status = 200, body = ExternalChatDetail)))]
pub async fn chat<P: ChatProvider, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<ExternalChatDetail>, ApiError> {
    Ok(Json(
        state.service.detail(&access.entity_access_receipt).await?,
    ))
}

/// Stop syncing the chat, locally. Owner only, in their own session.
#[utoipa::path(delete, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}", operation_id = "external_chat_remove", params(("chat_id" = Uuid, Path)), responses((status = 204)))]
pub async fn remove<P: ChatProvider, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: ExternalChatAccessLevelExtractor<OwnerAccessLevel, Eas, Auth>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .detach(
            &access.entity_access_receipt,
            authority(&auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Stable timeline pagination.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct TimelineQuery {
    /// Last message id in the previous page.
    pub before: Option<Uuid>,
    /// Page size, up to [`PAGE_LIMIT`]; [`DEFAULT_PAGE`] when absent.
    pub limit: Option<i64>,
}

/// Newest-first timeline through ordinary view access.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/messages", operation_id = "external_chat_messages", params(("chat_id" = Uuid, Path), TimelineQuery), responses((status = 200, body = ExternalChatMessages)))]
pub async fn messages<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Query(query): Query<TimelineQuery>,
) -> Result<Json<ExternalChatMessages>, ApiError> {
    Ok(Json(
        state
            .service
            .messages(&access.entity_access_receipt, query.before, query.limit)
            .await?,
    ))
}

/// Path of one timeline message.
#[derive(Deserialize)]
pub struct MessagePath {
    /// Unused here; the access extractor reads it.
    pub chat_id: Uuid,
    /// The message.
    pub message_id: Uuid,
}

/// One message of the timeline, as the timeline shows it.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/messages/{message_id}", operation_id = "external_chat_message", params(("chat_id" = Uuid, Path), ("message_id" = Uuid, Path)), responses((status = 200, body = ExternalChatMessage)))]
pub async fn message<P: ChatProvider, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Path(path): Path<MessagePath>,
) -> Result<Json<ExternalChatMessage>, ApiError> {
    Ok(Json(
        state
            .service
            .message(&access.entity_access_receipt, path.message_id)
            .await?,
    ))
}

/// Attachment states of messages, by message id (at most 100).
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/messages/attachments", operation_id = "external_chat_message_attachments", params(("chat_id" = Uuid, Path)), request_body = Vec<Uuid>, responses((status = 200, body = Vec<MessageAttachments>)))]
pub async fn message_attachments<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<MessageAttachments>>, ApiError> {
    Ok(Json(
        state
            .service
            .message_attachments(&access.entity_access_receipt, &ids)
            .await?,
    ))
}

/// Advance this viewer's read position.
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/read", operation_id = "external_chat_read", params(("chat_id" = Uuid, Path)), request_body = MarkRead, responses((status = 204)))]
pub async fn mark_read<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(body): Json<MarkRead>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .mark_read(&access.entity_access_receipt, body.message_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Generic Share dialog policy.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/permissions", operation_id = "external_chat_permissions", params(("chat_id" = Uuid, Path)), responses((status = 200, body = SharePermissionV2)))]
pub async fn permissions<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<SharePermissionV2>, ApiError> {
    Ok(Json(
        state
            .service
            .permissions(&access.entity_access_receipt)
            .await?,
    ))
}

/// The owner, in their own session, updates link, team and channel sharing.
#[utoipa::path(patch, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/permissions", operation_id = "external_chat_update_permissions", params(("chat_id" = Uuid, Path)), request_body = UpdateSharePermissionRequestV2, responses((status = 204)))]
pub async fn update_permissions<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: ExternalChatAccessLevelExtractor<OwnerAccessLevel, Eas, Auth>,
    Json(body): Json<UpdateSharePermissionRequestV2>,
) -> Result<StatusCode, ApiError> {
    state
        .service
        .update_permissions(
            &access.entity_access_receipt,
            &body,
            authority(&auth.authorization),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Caller-owned pending, failed and uncertain sends.
#[utoipa::path(get, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/sends", operation_id = "external_chat_sends", params(("chat_id" = Uuid, Path)), responses((status = 200, body = Vec<SendProgress>)))]
pub async fn open_sends<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        state
            .service
            .open_sends(&access.entity_access_receipt)
            .await?,
    ))
}

/// Send to the chat from the caller's own provider account (one request per second per user).
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/sends", operation_id = "external_chat_send", params(("chat_id" = Uuid, Path)), request_body = SendReply, responses((status = 200, body = SendProgress), (status = 429, description = "One send request per second per user; Retry-After: 1")))]
pub async fn send<P: ChatProvider, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(body): Json<SendReply>,
) -> Result<Json<SendProgress>, ApiError> {
    Ok(Json(
        state
            .service
            .send_reply(
                &access.entity_access_receipt,
                &body,
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// Multipart body of the attachments route.
#[derive(utoipa::ToSchema)]
#[schema(as = ExternalChatUploadRequest)]
pub struct UploadRequest {
    /// One supported image, audio, video, PDF or text file.
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
}

/// Stage one attachment for a later media send in this chat.
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/attachments", operation_id = "external_chat_upload", params(("chat_id" = Uuid, Path)), request_body(content = UploadRequest, content_type = "multipart/form-data"), responses((status = 200, body = UploadedAttachment)))]
pub async fn upload<P: ChatProvider, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    mut input: Multipart,
) -> Result<Json<UploadedAttachment>, ApiError> {
    let invalid = |message| ApiError(ExternalChatError::Invalid(message));
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
                authority(&auth.authorization),
            )
            .await?,
    ))
}

/// The caller's send progress for intents or messages.
#[utoipa::path(post, tag = "whatsapp_linked::inbound::router", path = "/external-chats/{chat_id}/delivery", operation_id = "external_chat_delivery", params(("chat_id" = Uuid, Path)), request_body = Vec<Uuid>, responses((status = 200, body = Vec<SendProgress>)))]
pub async fn delivery<
    P: ChatProvider,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ExternalChatRouterState<P, Eas, Auth>>,
    access: ExternalChatAccessLevelExtractor<ViewAccessLevel, Eas, Auth>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        state
            .service
            .delivery(&access.entity_access_receipt, &ids)
            .await?,
    ))
}

#[cfg(test)]
mod test;
