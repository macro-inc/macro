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
    extract::{FromRef, FromRequestParts, Path, State},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE, request::Parts},
    response::IntoResponse,
    routing::post,
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberParticipantRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_authorization::{
    BOT_TOKEN_HEADER, BotAuthentication, BotOnly, MacroAuthorizationRejection,
    MacroAuthorizationService, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, PostMessage},
    ports::MessageError,
};
use model_error_response::ErrorResponse;
use std::{marker::PhantomData, sync::Arc};
use uuid::Uuid;

/// Header used to authenticate channel bot webhook requests.
pub const CHANNEL_BOT_TOKEN_HEADER: &str = "x-macro-channel-bot-token";

/// State for the channel bot webhook router.
pub struct ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth> {
    bot_service: Arc<BotSvc>,
    channel_poster: Arc<dyn MessageCommands>,
    access_service: Arc<AccessSvc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<BotSvc, AccessSvc, Auth> Clone for ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth> {
    fn clone(&self) -> Self {
        Self {
            bot_service: self.bot_service.clone(),
            channel_poster: self.channel_poster.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<BotSvc, AccessSvc, Auth> ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>
where
    BotSvc: BotService,
    AccessSvc: EntityAccessService,
{
    /// Create a router state.
    pub fn new(
        bot_service: BotSvc,
        channel_poster: Arc<dyn MessageCommands>,
        access_service: AccessSvc,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            bot_service: Arc::new(bot_service),
            channel_poster,
            access_service: Arc::new(access_service),
            authorization_state,
        }
    }
}

impl<BotSvc, AccessSvc, Auth> FromRef<ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>>
    for Arc<AccessSvc>
{
    fn from_ref(state: &ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<BotSvc, AccessSvc, Auth> FromRef<ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

struct ChannelWebhookAuthorizationExtractor<Auth> {
    authentication: Option<BotAuthentication>,
    _service: PhantomData<fn() -> Auth>,
}

impl<S, Auth> FromRequestParts<S> for ChannelWebhookAuthorizationExtractor<Auth>
where
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = MacroAuthorizationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        if parts.headers.contains_key(BOT_TOKEN_HEADER)
            && parts.headers.contains_key(CHANNEL_BOT_TOKEN_HEADER)
        {
            return Err(MacroAuthorizationRejection {
                status: StatusCode::BAD_REQUEST,
                message: "ambiguous credentials".into(),
            });
        }

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, BotOnly>::from_request_parts(parts, state)
                .await?
                .authorization;
        Ok(Self {
            authentication: authorization,
            _service: PhantomData,
        })
    }
}

/// Channel id path.
#[derive(Debug, serde::Deserialize)]
pub struct ChannelPath {
    /// Channel id.
    pub channel_id: Uuid,
}

/// Create the authenticated channel-scoped bot creation router.
pub fn channel_scoped_bot_router<BotSvc, AccessSvc, Auth, T>(
    state: ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>,
) -> Router<T>
where
    BotSvc: BotService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/channels/{channel_id}/bots/scoped",
            post(create_channel_scoped_bot_handler::<BotSvc, AccessSvc, Auth>),
        )
        .with_state(state)
}

/// Create the unauthenticated channel bot webhook router.
pub fn channel_bot_webhook_router<BotSvc, AccessSvc, Auth, T>(
    state: ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>,
) -> Router<T>
where
    BotSvc: BotService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/channels/{channel_id}/webhook",
            post(post_channel_webhook_handler::<BotSvc, AccessSvc, Auth>),
        )
        .with_state(state)
}

fn caller_from_receipt(
    receipt: &EntityAccessReceipt<MemberParticipantRole>,
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
pub async fn create_channel_scoped_bot_handler<BotSvc, AccessSvc, Auth>(
    State(state): State<ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, AccessSvc, Auth>,
    Path(path): Path<ChannelPath>,
    Json(req): Json<CreateChannelScopedBotRequest>,
) -> Result<(StatusCode, Json<CreateChannelScopedBotResponse>), ChannelBotWebhookHandlerErr>
where
    BotSvc: BotService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
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
        ("x-macro-bot-token" = Option<String>, Header, description = "Preferred bot authentication token"),
        ("x-macro-channel-bot-token" = Option<String>, Header, deprecated, description = "Legacy channel-scoped bot authentication token")
    ),
    request_body = ChannelWebhookRequest,
    responses(
        (status = 200, body = ChannelWebhookResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(
    err,
    skip_all,
    fields(
        channel_id = tracing::field::Empty,
        bot_id = tracing::field::Empty,
        token_id = tracing::field::Empty,
        acting_user_id = tracing::field::Empty,
    )
)]
#[allow(
    private_interfaces,
    reason = "the public handler is referenced by DSS OpenAPI while its route-specific extractor stays private"
)]
pub async fn post_channel_webhook_handler<BotSvc, AccessSvc, Auth>(
    State(state): State<ChannelBotWebhookRouterState<BotSvc, AccessSvc, Auth>>,
    Path(path): Path<ChannelPath>,
    ChannelWebhookAuthorizationExtractor {
        authentication: preferred_authentication,
        ..
    }: ChannelWebhookAuthorizationExtractor<Auth>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<ChannelWebhookResponse>), ChannelBotWebhookHandlerErr>
where
    BotSvc: BotService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    tracing::Span::current().record("channel_id", tracing::field::display(path.channel_id));

    let content = parse_webhook_content(&headers, body)?;
    let access =
        webhook_access(&state, path.channel_id, preferred_authentication, &headers).await?;

    let response = state
        .channel_poster
        .post(
            access,
            PostMessage {
                content,
                mentions: Vec::new(),
                thread_id: None,
                attachments: Vec::new(),
                nonce: None,
                notification_policy: Default::default(),
                // External webhook bot posting on its own; no triggering user.
                attribution: MessageAttribution::Unprompted,
                anchor: None,
            },
        )
        .await?;

    Ok((
        StatusCode::OK,
        Json(ChannelWebhookResponse {
            message_id: response.id.to_string(),
        }),
    ))
}

fn record_preferred_bot(bot: &BotAuthentication) {
    let span = tracing::Span::current();
    span.record("bot_id", tracing::field::display(bot.bot_id));
    span.record("token_id", tracing::field::display(bot.token_id));
    if let Some(acting_user) = &bot.acting_user {
        span.record(
            "acting_user_id",
            tracing::field::display(&acting_user.macro_user_id),
        );
    }
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
    Message(#[from] MessageError),
}

impl IntoResponse for ChannelBotWebhookHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::BadRequest(_)
            | Self::Bot(BotError::BadRequest(_))
            | Self::Message(MessageError::Invalid(_)) => StatusCode::BAD_REQUEST,
            Self::Bot(BotError::Unauthorized) => StatusCode::UNAUTHORIZED,
            Self::Message(MessageError::Forbidden) => StatusCode::FORBIDDEN,
            Self::Bot(BotError::NotFound(_)) | Self::Message(MessageError::NotFound) => {
                StatusCode::NOT_FOUND
            }
            Self::Bot(BotError::Repo(_)) | Self::Message(MessageError::Repository(_)) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
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

/// Capability boundary for verified preferred or channel-bound bot credentials.
async fn webhook_access<B: BotService, A: EntityAccessService, Auth>(
    state: &ChannelBotWebhookRouterState<B, A, Auth>,
    channel_id: Uuid,
    preferred: Option<BotAuthentication>,
    headers: &HeaderMap,
) -> Result<EntityAccessReceipt<messages::domain::service::MessageWrite>, ChannelBotWebhookHandlerErr>
{
    use entity_access::domain::models::EntityType;
    let access = if let Some(authentication) = preferred {
        record_preferred_bot(&authentication);
        let membership = state
            .bot_service
            .channel_message_access(authentication.bot_id, channel_id)
            .await?;
        if authentication.acting_user.is_none() {
            return Ok(membership);
        } else {
            entity_access::inbound::axum_extractors::principal_entity_access_receipt(
                state.access_service.as_ref(),
                &macro_authorization::MacroAuthorization::Bot(authentication),
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
        }
    } else {
        return state
            .bot_service
            .authenticate_channel_token(channel_id, channel_bot_token(headers)?)
            .await
            .map_err(Into::into);
    };
    access.map_err(|error| match error {
        entity_access::domain::models::AccessError::Internal(error)
        | entity_access::domain::models::AccessError::Unavailable(error) => {
            BotError::Repo(anyhow::anyhow!(error.to_string())).into()
        }
        _ => BotError::Unauthorized.into(),
    })
}
