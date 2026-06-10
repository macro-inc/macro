//! Axum router for channel-scoped bot creation and webhook delivery.

#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        ChannelWebhookRequest, ChannelWebhookResponse, CreateChannelScopedBotRequest,
        CreateChannelScopedBotResponse,
    },
    ports::{BotError, BotService},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{FromRef, Path, State},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
    response::IntoResponse,
    routing::post,
};
use channels::domain::{
    models::{PostMessageRequest, PostMessageResponse, Sender},
    ports::{ChannelMutationErr, ChannelService},
};
use entity_access::{
    domain::{
        models::{AdminParticipantRole, EntityAccessReceipt},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use std::{future::Future, sync::Arc};
use uuid::Uuid;

/// Header used to authenticate channel bot webhook requests.
pub const CHANNEL_BOT_TOKEN_HEADER: &str = "x-macro-channel-bot-token";

/// Narrow adapter for posting channel messages from bot webhooks.
pub trait ChannelMessagePoster: Clone + Send + Sync + 'static {
    /// Post a message to a channel.
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send;
}

impl<S> ChannelMessagePoster for Arc<S>
where
    S: ChannelService,
{
    fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send {
        ChannelService::post_message(self.as_ref(), actor, channel_id, req)
    }
}

/// State for the channel bot webhook router.
pub struct ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc> {
    bot_service: Arc<BotSvc>,
    channel_poster: Arc<ChannelPoster>,
    access_service: Arc<AccessSvc>,
}

impl<BotSvc, ChannelPoster, AccessSvc> Clone
    for ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>
{
    fn clone(&self) -> Self {
        Self {
            bot_service: self.bot_service.clone(),
            channel_poster: self.channel_poster.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<BotSvc, ChannelPoster, AccessSvc>
    ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>
where
    BotSvc: BotService,
    ChannelPoster: ChannelMessagePoster,
    AccessSvc: EntityAccessService,
{
    /// Create a router state.
    pub fn new(
        bot_service: BotSvc,
        channel_poster: ChannelPoster,
        access_service: AccessSvc,
    ) -> Self {
        Self {
            bot_service: Arc::new(bot_service),
            channel_poster: Arc::new(channel_poster),
            access_service: Arc::new(access_service),
        }
    }
}

impl<BotSvc, ChannelPoster, AccessSvc>
    FromRef<ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>> for Arc<AccessSvc>
{
    fn from_ref(state: &ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>) -> Self {
        state.access_service.clone()
    }
}

/// Channel id path.
#[derive(Debug, serde::Deserialize)]
pub struct ChannelPath {
    /// Channel id.
    pub channel_id: Uuid,
}

/// Create the authenticated channel-scoped bot creation router.
pub fn channel_scoped_bot_router<BotSvc, ChannelPoster, AccessSvc, T>(
    state: ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>,
) -> Router<T>
where
    BotSvc: BotService,
    ChannelPoster: ChannelMessagePoster,
    AccessSvc: EntityAccessService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/channels/{channel_id}/bots/scoped",
            post(create_channel_scoped_bot_handler::<BotSvc, ChannelPoster, AccessSvc>),
        )
        .with_state(state)
}

/// Create the unauthenticated channel bot webhook router.
pub fn channel_bot_webhook_router<BotSvc, ChannelPoster, AccessSvc, T>(
    state: ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>,
) -> Router<T>
where
    BotSvc: BotService,
    ChannelPoster: ChannelMessagePoster,
    AccessSvc: EntityAccessService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/channels/{channel_id}/webhook",
            post(post_channel_webhook_handler::<BotSvc, ChannelPoster, AccessSvc>),
        )
        .with_state(state)
}

fn caller_from_receipt(
    receipt: &EntityAccessReceipt<AdminParticipantRole>,
) -> Result<MacroUserIdStr<'static>, ChannelBotWebhookHandlerErr> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| ChannelBotWebhookHandlerErr::BadRequest("authenticated user required"))
}

/// Handler for `POST /channels/{channel_id}/bots/scoped`.
#[utoipa::path(
    post,
    tag = "bots",
    operation_id = "create_channel_scoped_bot",
    path = "/channels/{channel_id}/bots/scoped",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    request_body = CreateChannelScopedBotRequest,
    responses(
        (status = 201, body = CreateChannelScopedBotResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_channel_scoped_bot_handler<BotSvc, ChannelPoster, AccessSvc>(
    State(state): State<ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, AccessSvc>,
    Path(path): Path<ChannelPath>,
    Json(req): Json<CreateChannelScopedBotRequest>,
) -> Result<(StatusCode, Json<CreateChannelScopedBotResponse>), ChannelBotWebhookHandlerErr>
where
    BotSvc: BotService,
    ChannelPoster: ChannelMessagePoster,
    AccessSvc: EntityAccessService,
{
    let caller = caller_from_receipt(&access.entity_access_receipt)?;
    let response = state
        .bot_service
        .create_channel_scoped_bot(caller, path.channel_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// Handler for `POST /channels/{channel_id}/webhook`.
#[utoipa::path(
    post,
    tag = "bots",
    operation_id = "post_channel_bot_webhook",
    path = "/channels/{channel_id}/webhook",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("x-macro-channel-bot-token" = String, Header, description = "Bot authentication token")
    ),
    request_body = ChannelWebhookRequest,
    responses(
        (status = 200, body = ChannelWebhookResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all, fields(channel_id = tracing::field::Empty))]
pub async fn post_channel_webhook_handler<BotSvc, ChannelPoster, AccessSvc>(
    State(state): State<ChannelBotWebhookRouterState<BotSvc, ChannelPoster, AccessSvc>>,
    Path(path): Path<ChannelPath>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<ChannelWebhookResponse>), ChannelBotWebhookHandlerErr>
where
    BotSvc: BotService,
    ChannelPoster: ChannelMessagePoster,
    AccessSvc: EntityAccessService,
{
    tracing::Span::current().record("channel_id", tracing::field::display(path.channel_id));

    let content = parse_webhook_content(&headers, body)?;
    let bot_auth_token = channel_bot_token(&headers)?;
    let authenticated = state
        .bot_service
        .authenticate_channel_token(path.channel_id, bot_auth_token)
        .await?;

    let response = state
        .channel_poster
        .post_message(
            Sender::Bot(authenticated.bot_id),
            path.channel_id,
            PostMessageRequest {
                content,
                mentions: Vec::new(),
                thread_id: None,
                attachments: Vec::new(),
                nonce: None,
            },
        )
        .await?;

    Ok((
        StatusCode::OK,
        Json(ChannelWebhookResponse {
            message_id: response.id,
        }),
    ))
}

fn channel_bot_token(headers: &HeaderMap) -> Result<&str, ChannelBotWebhookHandlerErr> {
    let token = headers
        .get(CHANNEL_BOT_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(ChannelBotWebhookHandlerErr::Bot(BotError::Unauthorized))?;

    if token.trim().is_empty() {
        return Err(ChannelBotWebhookHandlerErr::Bot(BotError::Unauthorized));
    }

    Ok(token)
}

fn parse_webhook_content(
    headers: &HeaderMap,
    body: Bytes,
) -> Result<String, ChannelBotWebhookHandlerErr> {
    if body.is_empty() {
        return Err(ChannelBotWebhookHandlerErr::BadRequest(
            "content is required",
        ));
    }

    if is_json_body(headers)
        && let Ok(request) = serde_json::from_slice::<ChannelWebhookRequest>(&body)
    {
        return require_non_empty_content(request.content);
    }

    let content = std::str::from_utf8(&body)
        .map_err(|_| ChannelBotWebhookHandlerErr::BadRequest("content must be valid UTF-8"))?
        .to_string();
    require_non_empty_content(content)
}

fn is_json_body(headers: &HeaderMap) -> bool {
    has_json_content_type(headers)
}

fn has_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("json"))
}

fn require_non_empty_content(content: String) -> Result<String, ChannelBotWebhookHandlerErr> {
    if content.trim().is_empty() {
        return Err(ChannelBotWebhookHandlerErr::BadRequest(
            "content is required",
        ));
    }
    Ok(content)
}

/// Channel bot webhook handler error.
#[derive(Debug, thiserror::Error)]
pub enum ChannelBotWebhookHandlerErr {
    /// Bad request.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Bot service error.
    #[error(transparent)]
    Bot(#[from] BotError),
    /// Channel mutation error.
    #[error(transparent)]
    Channel(#[from] ChannelMutationErr),
}

impl IntoResponse for ChannelBotWebhookHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::BadRequest(_) | Self::Bot(BotError::BadRequest(_)) => StatusCode::BAD_REQUEST,
            Self::Bot(BotError::Unauthorized)
            | Self::Channel(ChannelMutationErr::Unauthorized(_)) => StatusCode::UNAUTHORIZED,
            Self::Bot(BotError::NotFound(_)) | Self::Channel(ChannelMutationErr::NotFound(_)) => {
                StatusCode::NOT_FOUND
            }
            Self::Channel(ChannelMutationErr::BadRequest(_)) => StatusCode::BAD_REQUEST,
            Self::Bot(BotError::Repo(_))
            | Self::Channel(ChannelMutationErr::Repo(_))
            | Self::Channel(ChannelMutationErr::Gateway(_))
            | Self::Channel(ChannelMutationErr::Notification(_))
            | Self::Channel(ChannelMutationErr::Contacts(_)) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self, "channel bot webhook handler error");
        }

        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
