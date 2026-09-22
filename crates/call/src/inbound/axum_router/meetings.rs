//! Thin HTTP adapters for authenticated management and public meeting capabilities.

use std::time::Duration;

use super::*;
use crate::domain::meetings::{
    CreateMeetingRequest, GuestJoinRequest, Meeting, MeetingToken, MeetingsResponse,
    UpdateMeetingRequest,
};
use axum::RequestPartsExt;
use axum::extract::{FromRequestParts, Path};
use ip_extractor::ClientIp;
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitService,
    inbound::{RateLimitExtractable, RateLimitExtractor},
};

/// Per-IP budget for the unauthenticated meeting endpoints. Generous enough
/// for a guest reloading a join page; tight enough that scanning the 244-bit
/// token space is pointless.
pub struct PerIpPublicMeetingAccess(ClientIp);

impl<S> RateLimitExtractable<S> for PerIpPublicMeetingAccess
where
    S: Send + Sync,
{
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: 120,
            window: Duration::from_mins(60),
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-ip-call-meeting-public")
            .append(&self.0.origin_ip())
            .finish()
    }
}

impl<S> FromRequestParts<S> for PerIpPublicMeetingAccess
where
    S: Send + Sync,
{
    type Rejection = <ClientIp as FromRequestParts<S>>::Rejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let ip: ClientIp = parts.extract_with_state(state).await?;
        Ok(Self(ip))
    }
}

/// Enforce the per-IP budget before the handler runs. Unlike the shared
/// `rate_limit_middleware`, this never rolls back on failure responses:
/// probing unknown tokens must consume budget or scanning is unthrottled.
pub async fn enforce_public_rate_limit<R>(
    _permit: RateLimitExtractor<PerIpPublicMeetingAccess, R>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response
where
    R: RateLimitService + Clone + Send + Sync + 'static,
{
    next.run(req).await
}

/// A single email recipient for a call invitation.
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct InviteMeetingRequest {
    /// Recipient email; no Macro account is required.
    pub email: String,
}

/// Queue an owner-authorized guest invitation email.
#[utoipa::path(post, operation_id = "meeting_invite", path = "/call/meetings/invite/{token}",
    params(("token" = String, Path)), request_body = InviteMeetingRequest,
    responses((status = 204), (status = 400, body = ErrorResponse), (status = 403, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn invite<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    Path(token): Path<String>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<InviteMeetingRequest>,
) -> Result<StatusCode, CallError> {
    state
        .service
        .invite_to_meeting(
            actor.authorization.user.macro_user_id.clone(),
            MeetingToken::try_from(token)?,
            request.email,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handle `POST /call/meetings` through the call domain service.
#[utoipa::path(post, operation_id = "meeting_create", path = "/call/meetings",
    request_body = CreateMeetingRequest,
    responses((status = 200, body = Meeting), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn create<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CreateMeetingRequest>,
) -> Result<Json<Meeting>, CallError> {
    Ok(Json(
        state
            .service
            .create_meeting(actor.authorization.user.macro_user_id.clone(), request)
            .await?,
    ))
}

/// Handle `GET /call/meetings` through the call domain service.
#[utoipa::path(get, operation_id = "meeting_list", path = "/call/meetings",
    responses((status = 200, body = MeetingsResponse), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn list<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<MeetingsResponse>, CallError> {
    let meetings = state
        .service
        .list_meetings(actor.authorization.user.macro_user_id.clone())
        .await?;
    Ok(Json(MeetingsResponse { meetings }))
}

/// Handle `DELETE /call/meetings/{meeting_id}` through the call domain service.
#[utoipa::path(delete, operation_id = "meeting_cancel", path = "/call/meetings/{meeting_id}",
    params(("meeting_id" = Uuid, Path)),
    responses((status = 204), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn cancel<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    Path(meeting_id): Path<Uuid>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<StatusCode, CallError> {
    state
        .service
        .cancel_meeting(actor.authorization.user.macro_user_id.clone(), &meeting_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Handle `POST /call/record/{call_id}/link` through the call domain service.
#[utoipa::path(post, operation_id = "meeting_share", path = "/call/record/{call_id}/link",
    params(("call_id" = Uuid, Path)),
    responses((status = 200, body = Meeting), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn share<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    access: CallAccessLevelExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<Meeting>, CallError> {
    Ok(Json(
        state
            .service
            .share_call(access.entity_access_receipt)
            .await?,
    ))
}

/// Handle `POST /call/meetings/join/{token}` through the call domain service.
#[utoipa::path(post, operation_id = "meeting_join", path = "/call/meetings/join/{token}",
    params(("token" = String, Path)),
    responses((status = 200, body = CallTokenResponse), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn join<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    Path(token): Path<String>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<CallTokenResponse>, CallError> {
    Ok(Json(
        state
            .service
            .join_meeting(
                MeetingToken::try_from(token)?,
                actor.authorization.user.macro_user_id.clone(),
            )
            .await?,
    ))
}

/// Handle `GET /call/join/{token}` through the call domain service.
#[utoipa::path(get, operation_id = "meeting_lookup", path = "/call/join/{token}",
    params(("token" = String, Path)),
    responses((status = 200, body = Meeting), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn lookup<S: CallService>(
    State(state): State<WebhookRouterState<S>>,
    Path(token): Path<String>,
) -> Result<Json<Meeting>, CallError> {
    Ok(Json(
        state
            .service
            .get_meeting(MeetingToken::try_from(token)?)
            .await?,
    ))
}

/// Handle `POST /call/join/{token}` through the call domain service.
#[utoipa::path(post, operation_id = "meeting_guest_join", path = "/call/join/{token}",
    request_body = GuestJoinRequest,
    params(("token" = String, Path)),
    responses((status = 200, body = CallTokenResponse), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn guest_join<S: CallService>(
    State(state): State<WebhookRouterState<S>>,
    Path(token): Path<String>,
    Json(request): Json<GuestJoinRequest>,
) -> Result<Json<CallTokenResponse>, CallError> {
    Ok(Json(
        state
            .service
            .join_meeting_guest(MeetingToken::try_from(token)?, request)
            .await?,
    ))
}

/// Handle `POST /call/join/{token}/leave` through the call domain service.
#[utoipa::path(post, operation_id = "meeting_leave", path = "/call/join/{token}/leave",
    params(("token" = String, Path)),
    responses((status = 200, body = LeaveCallResponse), (status = 400, body = ErrorResponse), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn leave<S: CallService>(
    State(state): State<WebhookRouterState<S>>,
    Path(token): Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<Json<LeaveCallResponse>, CallError> {
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(CallError::Auth)?;
    Ok(Json(
        state
            .service
            .leave_meeting(MeetingToken::try_from(token)?, bearer)
            .await?,
    ))
}

/// Handle owner-authorized meeting title and schedule edits.
#[utoipa::path(patch, operation_id = "meeting_update", path = "/call/meetings/{meeting_id}",
    params(("meeting_id" = Uuid, Path)), request_body = UpdateMeetingRequest,
    responses((status = 200, body = Meeting), (status = 400, body = ErrorResponse), (status = 403, body = ErrorResponse))) ]
#[tracing::instrument(err, skip_all)]
pub async fn update<S: CallService, Svc: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<CallRouterState<S, Svc, Auth>>,
    Path(meeting_id): Path<Uuid>,
    actor: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<UpdateMeetingRequest>,
) -> Result<Json<Meeting>, CallError> {
    Ok(Json(
        state
            .service
            .update_meeting(
                actor.authorization.user.macro_user_id.clone(),
                &meeting_id,
                request,
            )
            .await?,
    ))
}
