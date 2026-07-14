//! Axum router for bot management and channel reach.

#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        AddChannelBotRequest, Bot, BotChannel, BotId, BotToken, CreateBotRequest,
        CreateBotTokenRequest, CreateBotTokenResponse, PatchBotRequest,
    },
    ports::{BotError, BotService},
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
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
use model_user::axum_extractor::MacroUserExtractor;
use std::sync::Arc;
use uuid::Uuid;

/// State for the bots router.
pub struct BotsRouterState<S, Svc> {
    service: Arc<S>,
    access_service: Arc<Svc>,
}

impl<S, Svc> Clone for BotsRouterState<S, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<S: BotService, Svc: EntityAccessService> BotsRouterState<S, Svc> {
    /// Create a router state.
    pub fn new(service: S, access_service: Svc) -> Self {
        Self {
            service: Arc::new(service),
            access_service: Arc::new(access_service),
        }
    }
}

impl<S, Svc> FromRef<BotsRouterState<S, Svc>> for Arc<Svc> {
    fn from_ref(state: &BotsRouterState<S, Svc>) -> Self {
        state.access_service.clone()
    }
}

/// Bot path.
#[derive(Debug, serde::Deserialize)]
pub struct BotPath {
    /// Bot id.
    pub bot_id: BotId,
}

/// Bot token path.
#[derive(Debug, serde::Deserialize)]
pub struct BotTokenPath {
    /// Bot id.
    pub bot_id: BotId,
    /// Token id.
    pub token_id: Uuid,
}

/// Channel path.
#[derive(Debug, serde::Deserialize)]
pub struct ChannelPath {
    /// Channel id.
    pub channel_id: Uuid,
}

/// Channel bot path.
#[derive(Debug, serde::Deserialize)]
pub struct ChannelBotPath {
    /// Channel id.
    pub channel_id: Uuid,
    /// Bot id.
    pub bot_id: BotId,
}

/// Bot channel path.
#[derive(Debug, serde::Deserialize)]
pub struct BotChannelPath {
    /// Bot id.
    pub bot_id: BotId,
    /// Channel id.
    pub channel_id: Uuid,
}

/// Create a bots router.
pub fn bots_router<S, Svc, T>(state: BotsRouterState<S, Svc>) -> Router<T>
where
    S: BotService,
    Svc: EntityAccessService,
    T: Send + Sync,
{
    Router::new()
        .route("/bots", get(list_bots_handler::<S, Svc>))
        .route("/bots", post(create_bot_handler::<S, Svc>))
        .route("/bots/{bot_id}", get(get_bot_handler::<S, Svc>))
        .route("/bots/{bot_id}", patch(patch_bot_handler::<S, Svc>))
        .route("/bots/{bot_id}", delete(delete_bot_handler::<S, Svc>))
        .route(
            "/bots/{bot_id}/channels",
            get(list_bot_channels_handler::<S, Svc>),
        )
        .route(
            "/bots/{bot_id}/channels/{channel_id}",
            delete(remove_bot_channel_handler::<S, Svc>),
        )
        .route("/bots/{bot_id}/tokens", get(list_tokens_handler::<S, Svc>))
        .route(
            "/bots/{bot_id}/tokens",
            post(create_token_handler::<S, Svc>),
        )
        .route(
            "/bots/{bot_id}/tokens/{token_id}",
            delete(revoke_token_handler::<S, Svc>),
        )
        .route(
            "/channels/{channel_id}/bots",
            get(list_channel_bots_handler::<S, Svc>),
        )
        .route(
            "/channels/{channel_id}/bots",
            post(add_channel_bot_handler::<S, Svc>),
        )
        .route(
            "/channels/{channel_id}/bots/{bot_id}",
            delete(remove_channel_bot_handler::<S, Svc>),
        )
        .with_state(state)
}

fn caller_from_user(user: MacroUserExtractor) -> MacroUserIdStr<'static> {
    user.macro_user_id
}

fn caller_from_receipt(
    receipt: &EntityAccessReceipt<AdminParticipantRole>,
) -> Result<MacroUserIdStr<'static>, BotsHandlerErr> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| BotsHandlerErr::BadRequest("authenticated user required"))
}

async fn create_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Json(req): Json<CreateBotRequest>,
) -> Result<(StatusCode, Json<Bot>), BotsHandlerErr> {
    let bot = state
        .service
        .create_bot(caller_from_user(user), req)
        .await?;
    Ok((StatusCode::CREATED, Json(bot)))
}

async fn list_bots_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
) -> Result<Json<Vec<Bot>>, BotsHandlerErr> {
    Ok(Json(state.service.list_bots(caller_from_user(user)).await?))
}

async fn get_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
) -> Result<Json<Bot>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .get_bot(caller_from_user(user), path.bot_id)
            .await?,
    ))
}

async fn patch_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
    Json(req): Json<PatchBotRequest>,
) -> Result<Json<Bot>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .patch_bot(caller_from_user(user), path.bot_id, req)
            .await?,
    ))
}

async fn delete_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .delete_bot(caller_from_user(user), path.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_token_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
    Json(req): Json<CreateBotTokenRequest>,
) -> Result<(StatusCode, Json<CreateBotTokenResponse>), BotsHandlerErr> {
    let token = state
        .service
        .create_token(caller_from_user(user), path.bot_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(token)))
}

async fn list_tokens_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
) -> Result<Json<Vec<BotToken>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_tokens(caller_from_user(user), path.bot_id)
            .await?,
    ))
}

async fn revoke_token_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotTokenPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .revoke_token(caller_from_user(user), path.bot_id, path.token_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handler for `GET /bots/{bot_id}/channels`.
#[utoipa::path(
    get,
    tag = "bots",
    operation_id = "list_bot_channels",
    path = "/bots/{bot_id}/channels",
    params(
        ("bot_id" = BotId, Path, description = "Bot ID")
    ),
    responses(
        (status = 200, body = Vec<BotChannel>),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_bot_channels_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotPath>,
) -> Result<Json<Vec<BotChannel>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_bot_channels(caller_from_user(user), path.bot_id)
            .await?,
    ))
}

/// Handler for `DELETE /bots/{bot_id}/channels/{channel_id}`.
#[utoipa::path(
    delete,
    tag = "bots",
    operation_id = "remove_bot_from_channel_by_bot",
    path = "/bots/{bot_id}/channels/{channel_id}",
    params(
        ("bot_id" = BotId, Path, description = "Bot ID"),
        ("channel_id" = Uuid, Path, description = "Channel ID")
    ),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn remove_bot_channel_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    user: MacroUserExtractor,
    Path(path): Path<BotChannelPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .remove_bot_from_channel(caller_from_user(user), path.channel_id, path.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_channel_bots_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    _access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc>,
    Path(path): Path<ChannelPath>,
) -> Result<Json<Vec<Bot>>, BotsHandlerErr> {
    Ok(Json(
        state.service.list_channel_bots(path.channel_id).await?,
    ))
}

async fn add_channel_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc>,
    Path(path): Path<ChannelPath>,
    Json(req): Json<AddChannelBotRequest>,
) -> Result<StatusCode, BotsHandlerErr> {
    let caller = caller_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .add_bot_to_channel(caller, path.channel_id, req.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_channel_bot_handler<S: BotService, Svc: EntityAccessService>(
    State(state): State<BotsRouterState<S, Svc>>,
    access: ChannelAccessLevelExtractor<AdminParticipantRole, Svc>,
    Path(path): Path<ChannelBotPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    let caller = caller_from_receipt(&access.entity_access_receipt)?;
    state
        .service
        .remove_bot_from_channel(caller, path.channel_id, path.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Bots handler error.
#[derive(Debug, thiserror::Error)]
pub enum BotsHandlerErr {
    /// Bad request.
    #[error("{0}")]
    BadRequest(&'static str),
    /// Domain error.
    #[error(transparent)]
    Bot(#[from] BotError),
}

impl IntoResponse for BotsHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::BadRequest(_) | Self::Bot(BotError::BadRequest(_)) => StatusCode::BAD_REQUEST,
            Self::Bot(BotError::NotFound(_)) => StatusCode::NOT_FOUND,
            Self::Bot(BotError::Unauthorized) => StatusCode::UNAUTHORIZED,
            Self::Bot(BotError::Repo(_)) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self, "bots handler error");
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
