//! HTTP endpoints for asking to join a channel and answering those requests.

use super::ChannelsRouterState;
use crate::domain::access_requests::{
    ChannelAccessRequest, ChannelAccessRequestErr, ChannelAccessRequestService,
    ChannelAccessRequestState, ResolveChannelAccessRequest,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use entity_access::{
    domain::{models::MemberParticipantRole, ports::EntityAccessService},
    inbound::axum_extractors::ChannelAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOnly};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use uuid::Uuid;

/// Build the router for requests to join channels, nested beneath `/channels`.
pub fn channel_access_requests_router<S, Svc, Auth, T>(
    state: ChannelsRouterState<S, Svc, Auth>,
) -> Router<T>
where
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route(
            "/{channel_id}/access-requests/mine",
            get(my_access_request_handler::<S, Svc, Auth>)
                .put(request_access_handler::<S, Svc, Auth>)
                .delete(cancel_access_request_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/access-requests/{request_id}",
            get(get_access_request_handler::<S, Svc, Auth>),
        )
        .route(
            "/{channel_id}/access-requests/{request_id}/resolve",
            post(resolve_access_request_handler::<S, Svc, Auth>),
        )
        .with_state(state)
}

/// Path of the channel a requester asks to join.
#[derive(Debug, Deserialize)]
pub struct ChannelPath {
    /// Channel id.
    channel_id: Uuid,
}

/// Path of one request in a channel.
#[derive(Debug, Deserialize)]
pub struct AccessRequestPath {
    /// Request id; the channel comes from the access receipt.
    request_id: Uuid,
}

impl IntoResponse for ChannelAccessRequestErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::ChannelNotFound | Self::NotFound => StatusCode::NOT_FOUND,
            Self::NotRequestable(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Cooldown(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Repo(error) => {
                tracing::error!(error=?error, "channel access request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Handler for `GET /channels/{channel_id}/access-requests/mine`.
#[utoipa::path(
    get,
    tag = "channels",
    operation_id = "get_my_channel_access_request",
    path = "/channels/{channel_id}/access-requests/mine",
    params(("channel_id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, body = ChannelAccessRequestState),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn my_access_request_handler<
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<ChannelPath>,
) -> Result<Json<ChannelAccessRequestState>, ChannelAccessRequestErr> {
    Ok(Json(
        state
            .service
            .my_access_request(user.authorization.macro_user_id, path.channel_id)
            .await?,
    ))
}

/// Handler for `PUT /channels/{channel_id}/access-requests/mine`.
#[utoipa::path(
    put,
    tag = "channels",
    operation_id = "request_channel_access",
    path = "/channels/{channel_id}/access-requests/mine",
    params(("channel_id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200, body = ChannelAccessRequest),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn request_access_handler<
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<ChannelPath>,
) -> Result<Json<ChannelAccessRequest>, ChannelAccessRequestErr> {
    Ok(Json(
        state
            .service
            .request_access(user.authorization.macro_user_id, path.channel_id)
            .await?,
    ))
}

/// Handler for `DELETE /channels/{channel_id}/access-requests/mine`.
#[utoipa::path(
    delete,
    tag = "channels",
    operation_id = "cancel_channel_access_request",
    path = "/channels/{channel_id}/access-requests/mine",
    params(("channel_id" = Uuid, Path, description = "Channel ID")),
    responses(
        (status = 200),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn cancel_access_request_handler<
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(path): Path<ChannelPath>,
) -> Result<StatusCode, ChannelAccessRequestErr> {
    state
        .service
        .cancel_access_request(user.authorization.macro_user_id, path.channel_id)
        .await?;
    Ok(StatusCode::OK)
}

/// Handler for `GET /channels/{channel_id}/access-requests/{request_id}`.
#[utoipa::path(
    get,
    tag = "channels",
    operation_id = "get_channel_access_request",
    path = "/channels/{channel_id}/access-requests/{request_id}",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("request_id" = Uuid, Path, description = "Access request ID"),
    ),
    responses(
        (status = 200, body = ChannelAccessRequest),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_access_request_handler<
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Path(path): Path<AccessRequestPath>,
) -> Result<Json<ChannelAccessRequest>, ChannelAccessRequestErr> {
    Ok(Json(
        state
            .service
            .get_access_request(access.entity_access_receipt, path.request_id)
            .await?,
    ))
}

/// Handler for `POST /channels/{channel_id}/access-requests/{request_id}/resolve`.
#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "resolve_channel_access_request",
    path = "/channels/{channel_id}/access-requests/{request_id}/resolve",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("request_id" = Uuid, Path, description = "Access request ID"),
    ),
    request_body = ResolveChannelAccessRequest,
    responses(
        (status = 200, body = ChannelAccessRequest),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn resolve_access_request_handler<
    S: ChannelAccessRequestService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ChannelsRouterState<S, Svc, Auth>>,
    access: ChannelAccessLevelExtractor<MemberParticipantRole, Svc, Auth>,
    Path(path): Path<AccessRequestPath>,
    Json(body): Json<ResolveChannelAccessRequest>,
) -> Result<Json<ChannelAccessRequest>, ChannelAccessRequestErr> {
    Ok(Json(
        state
            .service
            .resolve_access_request(access.entity_access_receipt, path.request_id, body.decision)
            .await?,
    ))
}
