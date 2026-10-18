//! Thin HTTP adapters: typed access receipts flow to the domain service.

mod groups;

use crate::domain::{
    connection::*,
    history::HistoryImportView,
    meta::MetaService,
    models::{MessagingError, Provider},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, FromRef, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::{ChannelAccessLevelExtractor, MacroUserTeamExtractorV2},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use messages::domain::service::{MessageView, MessageWrite};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

/// Provider-specific webhook secrets loaded and validated by the host.
pub struct WebhookCredentials {
    /// Secret used to authenticate POST payloads.
    pub signature_secret: String,
    /// Independently configured GET verification token.
    pub verify_token: String,
}
/// Independent products may use different app-secret credentials.
pub struct WebhookConfiguration {
    /// WhatsApp app verification, absent when unconfigured.
    pub whatsapp: Option<WebhookCredentials>,
    /// Instagram app verification, absent when unconfigured.
    pub instagram: Option<WebhookCredentials>,
}
/// Native authorization capabilities and domain use cases supplied by DSS.
pub struct MessagingRouterState<Eas, Auth> {
    /// Messaging use-case service.
    pub service: Arc<MetaService>,
    /// Existing entity access authority.
    pub entity_access_service: Arc<Eas>,
    /// Existing authentication authority.
    pub authorization_state: MacroAuthorizationState<Auth>,
    /// Server-only webhook verification configuration.
    pub webhooks: Arc<WebhookConfiguration>,
}
impl<Eas, Auth> Clone for MessagingRouterState<Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
            webhooks: self.webhooks.clone(),
        }
    }
}
impl<Eas, Auth> FromRef<MessagingRouterState<Eas, Auth>> for Arc<Eas> {
    fn from_ref(s: &MessagingRouterState<Eas, Auth>) -> Self {
        s.entity_access_service.clone()
    }
}
impl<Eas, Auth> FromRef<MessagingRouterState<Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(s: &MessagingRouterState<Eas, Auth>) -> Self {
        s.authorization_state.clone()
    }
}

/// Authenticated settings and conversation routes mounted under `/meta`.
pub fn router<Eas, Auth, S>(state: MessagingRouterState<Eas, Auth>) -> Router<S>
where
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .merge(groups::router::<Eas, Auth>())
        .route("/configuration", get(configuration::<Eas, Auth>))
        .route("/connections", get(connections::<Eas, Auth>))
        .route("/authorize", post(begin::<Eas, Auth>))
        .route("/authorize/complete", post(complete::<Eas, Auth>))
        .route(
            "/connections/{connection_id}/register",
            post(register::<Eas, Auth>),
        )
        .route("/developer/whatsapp", post(developer::<Eas, Auth>))
        .route(
            "/connections/{connection_id}/disconnect",
            post(disconnect::<Eas, Auth>),
        )
        .route(
            "/connections/{connection_id}/history",
            get(history::<Eas, Auth>).post(import_history::<Eas, Auth>),
        )
        .route("/channels/{channel_id}", get(conversation::<Eas, Auth>))
        .route(
            "/channels/{channel_id}/delivery",
            post(delivery::<Eas, Auth>),
        )
        .route(
            "/channels/{channel_id}/templates",
            get(templates::<Eas, Auth>),
        )
        .route("/channels/{channel_id}/replies", post(reply::<Eas, Auth>))
        .route(
            "/channels/{channel_id}/attachments",
            post(upload::<Eas, Auth>).layer(DefaultBodyLimit::max(
                crate::domain::media::MAX_FILE_BYTES + 64 * 1024,
            )),
        )
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state)
}
/// Signature-authenticated provider callbacks mounted outside user authentication.
pub fn webhook_router<Eas, Auth, S>(state: MessagingRouterState<Eas, Auth>) -> Router<S>
where
    Eas: Send + Sync + 'static,
    Auth: Send + Sync + 'static,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/webhooks/{provider}",
            get(verify::<Eas, Auth>).post(receive::<Eas, Auth>),
        )
        .layer(DefaultBodyLimit::max(super::webhook::MAX_WEBHOOK_BYTES))
        .with_state(state)
}

/// Sanitized transport error. Diagnostic causes are never serialized to clients.
pub struct ApiError(MessagingError);
impl From<rootcause::Report<MessagingError>> for ApiError {
    fn from(e: rootcause::Report<MessagingError>) -> Self {
        Self(e.current_context().clone())
    }
}
impl From<MessagingError> for ApiError {
    fn from(e: MessagingError) -> Self {
        Self(e)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            MessagingError::Forbidden => StatusCode::FORBIDDEN,
            MessagingError::NotFound => StatusCode::NOT_FOUND,
            MessagingError::Conflict | MessagingError::IdentityConflict => StatusCode::CONFLICT,
            MessagingError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::UNPROCESSABLE_ENTITY,
        };
        (
            status,
            Json(serde_json::json!({"code":self.0.code(),"message":self.0.to_string()})),
        )
            .into_response()
    }
}

/// Initiate a product-specific official login.
#[derive(Deserialize, utoipa::ToSchema)]
pub struct BeginRequest {
    /// Product to connect.
    pub provider: Provider,
    /// Existing connection identity, when reconnecting.
    pub reconnect_id: Option<Uuid>,
}

#[utoipa::path(get,path="/meta/configuration",operation_id="meta_configuration",responses((status=200,body=PublicConfiguration)))]
async fn configuration<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Json<PublicConfiguration> {
    Json(s.service.configuration().clone())
}
#[utoipa::path(get,path="/meta/connections",operation_id="meta_connections",responses((status=200,body=Vec<Connection>)))]
async fn connections<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
) -> Result<Json<Vec<Connection>>, ApiError> {
    Ok(Json(s.service.connections(&a.entity_access_receipt).await?))
}
#[utoipa::path(post,path="/meta/authorize",operation_id="meta_authorize",request_body=BeginRequest,responses((status=200,body=BeginAuthorization)))]
async fn begin<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Json(body): Json<BeginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(
            s.service
                .begin_authorization(&a.entity_access_receipt, body.provider, body.reconnect_id)
                .await?,
        ),
    ))
}
#[utoipa::path(post,path="/meta/authorize/complete",operation_id="meta_authorize_complete",request_body=CompleteAuthorization,responses((status=200,body=Connection)))]
async fn complete<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Json(body): Json<CompleteAuthorization>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(
            s.service
                .complete_authorization(&a.entity_access_receipt, body)
                .await?,
        ),
    ))
}
#[utoipa::path(post,path="/meta/connections/{connection_id}/register",operation_id="meta_register",params(("connection_id"=Uuid,Path)),request_body=RegisterPhone,responses((status=200,body=Connection)))]
async fn register<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Path(id): Path<Uuid>,
    Json(body): Json<RegisterPhone>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(
            s.service
                .register_phone(&a.entity_access_receipt, id, body)
                .await?,
        ),
    ))
}
#[utoipa::path(post,path="/meta/developer/whatsapp",operation_id="meta_developer_whatsapp",responses((status=200,body=Connection)))]
async fn developer<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
) -> Result<Json<Connection>, ApiError> {
    Ok(Json(
        s.service
            .connect_developer(&a.entity_access_receipt)
            .await?,
    ))
}
#[utoipa::path(post,path="/meta/connections/{connection_id}/disconnect",operation_id="meta_disconnect",params(("connection_id"=Uuid,Path)),responses((status=200,body=DisconnectResult)))]
async fn disconnect<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<DisconnectResult>, ApiError> {
    Ok(Json(
        s.service.disconnect(&a.entity_access_receipt, id).await?,
    ))
}
#[utoipa::path(get,path="/meta/connections/{connection_id}/history",operation_id="meta_history",params(("connection_id"=Uuid,Path)),responses((status=200,body=HistoryImportView)))]
async fn history<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<HistoryImportView>, ApiError> {
    Ok(Json(
        s.service
            .history_import_view(&a.entity_access_receipt, id)
            .await?,
    ))
}
#[utoipa::path(post,path="/meta/connections/{connection_id}/history",operation_id="meta_import_history",params(("connection_id"=Uuid,Path)),responses((status=200,body=HistoryImportView)))]
async fn import_history<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    Path(id): Path<Uuid>,
) -> Result<Json<HistoryImportView>, ApiError> {
    Ok(Json(
        s.service
            .import_history(&a.entity_access_receipt, id)
            .await?,
    ))
}
#[utoipa::path(get,path="/meta/channels/{channel_id}",operation_id="meta_conversation",params(("channel_id"=Uuid,Path)),responses((status=200,body=ConversationResponse)))]
async fn conversation<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<MessageView, Eas, Auth>,
    headers: HeaderMap,
) -> Result<Json<ConversationResponse>, ApiError> {
    Ok(Json(ConversationResponse {
        group: s
            .service
            .group_view(&a.entity_access_receipt, send_authority(&headers))
            .await?,
        messaging: s
            .service
            .conversation_view(&a.entity_access_receipt, send_authority(&headers))
            .await?,
    }))
}
#[utoipa::path(post,path="/meta/channels/{channel_id}/delivery",operation_id="meta_message_delivery",params(("channel_id"=Uuid,Path)),request_body=Vec<Uuid>,responses((status=200,body=Vec<SendProgress>)))]
async fn delivery<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<MessageView, Eas, Auth>,
    Json(message_ids): Json<Vec<Uuid>>,
) -> Result<Json<Vec<SendProgress>>, ApiError> {
    Ok(Json(
        s.service
            .messaging
            .message_delivery(&a.entity_access_receipt, &message_ids)
            .await?,
    ))
}
#[utoipa::path(get,path="/meta/channels/{channel_id}/templates",operation_id="meta_templates",params(("channel_id"=Uuid,Path)),responses((status=200,body=Vec<Template>)))]
async fn templates<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    a: ChannelAccessLevelExtractor<MessageView, Eas, Auth>,
) -> Result<Json<Vec<Template>>, ApiError> {
    Ok(Json(s.service.templates(&a.entity_access_receipt).await?))
}
#[utoipa::path(post,path="/meta/channels/{channel_id}/replies",operation_id="meta_reply",params(("channel_id"=Uuid,Path)),request_body=SendReply,responses((status=200,body=SendProgress)))]
async fn reply<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    a: ChannelAccessLevelExtractor<MessageWrite, Eas, Auth>,
    headers: HeaderMap,
    Json(body): Json<SendReply>,
) -> Result<Json<SendProgress>, ApiError> {
    // This records the authentication mechanism, not a client-supplied actor flag.
    // User API keys are automation credentials even when they resolve to a user.
    let authority = send_authority(&headers);
    Ok(Json(
        s.service
            .messaging
            .send_reply(&a.entity_access_receipt, body, authority)
            .await?,
    ))
}

fn send_authority(headers: &HeaderMap) -> crate::domain::policy::SendAuthority {
    if headers.contains_key(macro_authorization::USER_API_KEY_HEADER) {
        crate::domain::policy::SendAuthority::DraftOnly
    } else {
        crate::domain::policy::SendAuthority::Human
    }
}

/// Multipart private-file staging contract.
#[derive(utoipa::ToSchema)]
#[schema(as=MetaUploadRequest)]
pub struct UploadRequest {
    /// One image, audio, video or PDF file.
    #[schema(value_type=String,format=Binary)]
    pub file: Vec<u8>,
}
#[utoipa::path(post,path="/meta/channels/{channel_id}/attachments",operation_id="meta_upload_attachment",params(("channel_id"=Uuid,Path)),request_body(content=UploadRequest,content_type="multipart/form-data"),responses((status=200,body=UploadedAttachment)))]
async fn upload<Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(s): State<MessagingRouterState<Eas, Auth>>,
    _auth: MacroAuthorizationExtractor<Auth, UserOnly>,
    a: ChannelAccessLevelExtractor<MessageWrite, Eas, Auth>,
    mut input: Multipart,
) -> Result<Json<UploadedAttachment>, ApiError> {
    let field = input
        .next_field()
        .await
        .map_err(|_| MessagingError::Invalid("invalid attachment upload"))?
        .ok_or(MessagingError::Invalid("choose a file"))?;
    if field.name() != Some("file") {
        return Err(MessagingError::Invalid("upload must contain one file field").into());
    }
    let filename = field
        .file_name()
        .ok_or(MessagingError::Invalid("filename is required"))?
        .to_owned();
    let mime = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_owned();
    let mime = match mime.as_str() {
        "audio/x-m4a" => "audio/mp4".into(),
        "audio/x-wav" => "audio/wav".into(),
        _ => mime,
    };
    let bytes = field
        .bytes()
        .await
        .map_err(|_| MessagingError::Invalid("file exceeds the upload limit"))?
        .to_vec();
    if input
        .next_field()
        .await
        .map_err(|_| MessagingError::Invalid("invalid multipart upload"))?
        .is_some()
    {
        return Err(MessagingError::Invalid("send one attachment at a time").into());
    }
    Ok(Json(
        s.service
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

#[derive(Deserialize)]
struct Verification {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}
fn credentials<E, A>(
    state: &MessagingRouterState<E, A>,
    provider: Provider,
) -> Result<&WebhookCredentials, ApiError> {
    match provider {
        Provider::Whatsapp => state.webhooks.whatsapp.as_ref(),
        Provider::Instagram => state.webhooks.instagram.as_ref(),
    }
    .ok_or(ApiError(MessagingError::Unavailable))
}
async fn verify<E: Send + Sync + 'static, A: Send + Sync + 'static>(
    State(s): State<MessagingRouterState<E, A>>,
    Path(p): Path<Provider>,
    Query(q): Query<Verification>,
) -> Result<String, ApiError> {
    use hmac::{Hmac, Mac};
    let config = credentials(&s, p)?;
    let mut expected = Hmac::<Sha256>::new_from_slice(config.signature_secret.as_bytes())
        .map_err(|_| MessagingError::Unavailable)?;
    expected.update(config.verify_token.as_bytes());
    let mut actual = Hmac::<Sha256>::new_from_slice(config.signature_secret.as_bytes())
        .map_err(|_| MessagingError::Unavailable)?;
    actual.update(q.token.as_bytes());
    if q.mode != "subscribe"
        || q.challenge.len() > 1024
        || expected
            .verify_slice(&actual.finalize().into_bytes())
            .is_err()
    {
        return Err(MessagingError::Forbidden.into());
    }
    Ok(q.challenge)
}
async fn receive<E: Send + Sync + 'static, A: Send + Sync + 'static>(
    State(s): State<MessagingRouterState<E, A>>,
    Path(p): Path<Provider>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<&'static str, ApiError> {
    let config = credentials(&s, p)?;
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|h| h.to_str().ok())
        .ok_or(MessagingError::Forbidden)?;
    super::webhook::verify_signature(config.signature_secret.as_bytes(), signature, &body)?;
    let payload = serde_json::from_slice(&body)
        .map_err(|_| MessagingError::Invalid("invalid webhook JSON"))?;
    s.service
        .receive(p, &Sha256::digest(&body), &payload)
        .await?;
    Ok("EVENT_RECEIVED")
}

/// API contracts merged into DSS's generated OpenAPI document.
#[derive(utoipa::OpenApi)]
#[openapi(paths(
    groups::delete,
    groups::discard,
    groups::create,
    groups::retry,
    groups::link,
    groups::remove,
    configuration,
    connections,
    begin,
    complete,
    developer,
    register,
    disconnect,
    history,
    import_history,
    conversation,
    delivery,
    templates,
    reply,
    upload
))]
pub struct MessagingApiDoc;
