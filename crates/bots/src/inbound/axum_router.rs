//! Axum router for bot management and channel reach.

#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        AddChannelBotRequest, Agent, Bot, BotChannel, BotChannelListCaller, BotId, BotToken,
        CreateAgentRequest, CreateBotRequest, CreateBotTokenRequest, CreateBotTokenResponse,
        PatchBotRequest, UpdateAgentRequest,
    },
    ports::{BotError, BotService},
};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberParticipantRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_authorization::{
    AnyPrincipal, BotOnly, MacroAuthorization, MacroAuthorizationExtractor,
    MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use std::sync::Arc;
use uuid::Uuid;

/// State for the bots router.
pub struct BotsRouterState<S, Svc, Auth> {
    service: Arc<S>,
    access_service: Arc<Svc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Svc, Auth> Clone for BotsRouterState<S, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: BotService, Svc: EntityAccessService, Auth> BotsRouterState<S, Svc, Auth> {
    /// Create a router state.
    pub fn new(
        service: S,
        access_service: Svc,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service: Arc::new(service),
            access_service: Arc::new(access_service),
            authorization_state,
        }
    }
}

impl<S, Svc, Auth> FromRef<BotsRouterState<S, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &BotsRouterState<S, Svc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, Svc, Auth> FromRef<BotsRouterState<S, Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &BotsRouterState<S, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Bot path.
#[derive(Debug, serde::Deserialize)]
pub struct BotPath {
    /// Bot id.
    pub bot_id: BotId,
}

/// Agent path.
#[derive(Debug, serde::Deserialize)]
pub struct AgentPath {
    /// Agent bot id.
    pub agent_id: BotId,
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
pub fn bots_router<S, Svc, Auth, T>(state: BotsRouterState<S, Svc, Auth>) -> Router<T>
where
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route("/agents", get(list_agents_handler::<S, Svc, Auth>))
        .route("/agents", post(create_agent_handler::<S, Svc, Auth>))
        .route(
            "/agents/{agent_id}",
            put(update_agent_handler::<S, Svc, Auth>),
        )
        .route("/bots", get(list_bots_handler::<S, Svc, Auth>))
        .route("/bots", post(create_bot_handler::<S, Svc, Auth>))
        .route("/bots/me", get(get_self_bot_handler::<S, Svc, Auth>))
        .route("/bots/{bot_id}", get(get_bot_handler::<S, Svc, Auth>))
        .route("/bots/{bot_id}", patch(patch_bot_handler::<S, Svc, Auth>))
        .route("/bots/{bot_id}", delete(delete_bot_handler::<S, Svc, Auth>))
        .route(
            "/bots/{bot_id}/channels",
            get(list_bot_channels_handler::<S, Svc, Auth>),
        )
        .route(
            "/bots/{bot_id}/channels/{channel_id}",
            delete(remove_bot_channel_handler::<S, Svc, Auth>),
        )
        .route(
            "/bots/{bot_id}/tokens",
            get(list_tokens_handler::<S, Svc, Auth>),
        )
        .route(
            "/bots/{bot_id}/tokens",
            post(create_token_handler::<S, Svc, Auth>),
        )
        .route(
            "/bots/{bot_id}/tokens/{token_id}",
            delete(revoke_token_handler::<S, Svc, Auth>),
        )
        .route(
            "/channels/{channel_id}/bots",
            get(list_channel_bots_handler::<S, Svc, Auth>),
        )
        .route(
            "/channels/{channel_id}/bots",
            post(add_channel_bot_handler::<S, Svc, Auth>),
        )
        .route(
            "/channels/{channel_id}/bots/{bot_id}",
            delete(remove_channel_bot_handler::<S, Svc, Auth>),
        )
        .with_state(state)
}

/// Handler for `POST /agents`.
#[utoipa::path(
    post,
    tag = "agents",
    operation_id = "create_agent",
    path = "/agents",
    request_body = CreateAgentRequest,
    responses(
        (status = 201, body = Agent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn create_agent_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<(StatusCode, Json<Agent>), BotsHandlerErr> {
    let agent = state
        .service
        .create_agent(authorization.authorization.user.macro_user_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(agent)))
}

/// Handler for `GET /agents`.
#[utoipa::path(
    get,
    tag = "agents",
    operation_id = "list_agents",
    path = "/agents",
    responses(
        (status = 200, body = Vec<Agent>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_agents_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Agent>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_agents(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `PUT /agents/{agent_id}`.
#[utoipa::path(
    put,
    tag = "agents",
    operation_id = "update_agent",
    path = "/agents/{agent_id}",
    params(
        ("agent_id" = BotId, Path, description = "Agent bot ID")
    ),
    request_body = UpdateAgentRequest,
    responses(
        (status = 200, body = Agent),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn update_agent_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<AgentPath>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<Json<Agent>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .update_agent(
                authorization.authorization.user.macro_user_id,
                path.agent_id,
                req,
            )
            .await?,
    ))
}

fn caller_from_receipt(
    receipt: &EntityAccessReceipt<MemberParticipantRole>,
) -> Result<MacroUserIdStr<'static>, BotsHandlerErr> {
    receipt
        .get_authenticated_user()
        .cloned()
        .map_err(|_| BotsHandlerErr::BadRequest("authenticated user required"))
}

async fn create_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreateBotRequest>,
) -> Result<(StatusCode, Json<Bot>), BotsHandlerErr> {
    let bot = state
        .service
        .create_bot(authorization.authorization.user.macro_user_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(bot)))
}

async fn list_bots_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Bot>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_bots(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `GET /bots/me`.
#[utoipa::path(
    get,
    tag = "bots",
    operation_id = "get_self_bot",
    path = "/bots/me",
    responses(
        (status = 200, body = Bot),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_self_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, BotOnly>,
) -> Result<Json<Bot>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .get_self(authorization.authorization.bot_id)
            .await?,
    ))
}

async fn get_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotPath>,
) -> Result<Json<Bot>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .get_bot(authorization.authorization.user.macro_user_id, path.bot_id)
            .await?,
    ))
}

async fn patch_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotPath>,
    Json(req): Json<PatchBotRequest>,
) -> Result<Json<Bot>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .patch_bot(
                authorization.authorization.user.macro_user_id,
                path.bot_id,
                req,
            )
            .await?,
    ))
}

async fn delete_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .delete_bot(authorization.authorization.user.macro_user_id, path.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn create_token_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotPath>,
    Json(req): Json<CreateBotTokenRequest>,
) -> Result<(StatusCode, Json<CreateBotTokenResponse>), BotsHandlerErr> {
    let token = state
        .service
        .create_token(
            authorization.authorization.user.macro_user_id,
            path.bot_id,
            req,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(token)))
}

async fn list_tokens_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotPath>,
) -> Result<Json<Vec<BotToken>>, BotsHandlerErr> {
    Ok(Json(
        state
            .service
            .list_tokens(authorization.authorization.user.macro_user_id, path.bot_id)
            .await?,
    ))
}

async fn revoke_token_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotTokenPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .revoke_token(
            authorization.authorization.user.macro_user_id,
            path.bot_id,
            path.token_id,
        )
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
pub async fn list_bot_channels_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    Path(path): Path<BotPath>,
) -> Result<Json<Vec<BotChannel>>, BotsHandlerErr> {
    let caller = match authorization.authorization {
        MacroAuthorization::User(user) => BotChannelListCaller::User(user.macro_user_id),
        MacroAuthorization::Bot(bot) => BotChannelListCaller::Bot(bot.bot_id),
        MacroAuthorization::Harness(_) => {
            return Err(BotsHandlerErr::Bot(BotError::Unauthorized));
        }
        MacroAuthorization::Internal(_) => BotChannelListCaller::Internal,
    };
    Ok(Json(
        state.service.list_bot_channels(caller, path.bot_id).await?,
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
pub async fn remove_bot_channel_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<BotChannelPath>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .remove_bot_from_channel(
            authorization.authorization.user.macro_user_id,
            path.channel_id,
            path.bot_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_channel_bots_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    _access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Path(path): Path<ChannelPath>,
) -> Result<Json<Vec<Bot>>, BotsHandlerErr> {
    Ok(Json(
        state.service.list_channel_bots(path.channel_id).await?,
    ))
}

async fn add_channel_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Path(_path): Path<ChannelPath>,
    Json(req): Json<AddChannelBotRequest>,
) -> Result<StatusCode, BotsHandlerErr> {
    state
        .service
        .add_bot_to_channel(access.entity_access_receipt, req.bot_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_channel_bot_handler<
    S: BotService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<BotsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
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
