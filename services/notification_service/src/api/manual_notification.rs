//! `POST /user_notifications/send`: send a notification the caller wrote.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{FromRef, FromRequestParts, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use axum_extra::extract::Cached;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationState, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_error_response::ErrorResponse;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use notification::outbound::rate_limit::RedisRateLimitAdapter;
use rate_limit::domain::models::RateLimitOk;
use rate_limit::inbound::{RateLimitExtractable, rate_limit_middleware};
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitService, RateLimitServiceImpl,
};
use rootcause::Report;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::api::context::AuthorizationService;
use crate::manual::bots::BotAgentProfiles;
use crate::manual::entity_access::EntityAccessLinks;
use crate::manual::{
    ManualNotificationDraft, ManualNotificationError, ManualNotifications, ManualSender,
};

/// Sends per acting user per window; a routine reporting back stays far below it.
const SENDS_PER_WINDOW: u64 = 60;
const WINDOW: Duration = Duration::from_secs(60 * 60);

pub(crate) type Notifications = ManualNotifications<
    EntityAccessLinks<EntityAccessServiceImpl<PgAccessRepository>>,
    BotAgentProfiles<PgBotsRepo>,
    SqsNotificationIngress<SqsQueue>,
>;

pub(crate) type RateLimiter = RateLimitServiceImpl<RedisRateLimitAdapter<redis::Client>>;

/// State for the manual notification route.
pub(crate) struct ManualNotificationState {
    pub notifications: Arc<Notifications>,
    pub rate_limiter: RateLimiter,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
}

impl Clone for ManualNotificationState {
    fn clone(&self) -> Self {
        Self {
            notifications: Arc::clone(&self.notifications),
            rate_limiter: self.rate_limiter.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl FromRef<ManualNotificationState> for MacroAuthorizationState<AuthorizationService> {
    fn from_ref(state: &ManualNotificationState) -> Self {
        state.authorization_state.clone()
    }
}

impl RateLimitService for ManualNotificationState {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.rate_limiter.check_rate_limit(key, config).await
    }

    async fn rollback_ticket(&self, ticket: RateLimitOk) -> Result<(), Report> {
        self.rate_limiter.rollback_ticket(ticket).await
    }
}

/// The per-sender limit on manual notifications.
pub(crate) struct PerSenderRateLimit {
    sender: MacroUserIdStr<'static>,
}

impl RateLimitExtractable<ManualNotificationState> for PerSenderRateLimit {
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            max_count: SENDS_PER_WINDOW,
            window: WINDOW,
        }
    }

    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"manual-notification")
            .append(&self.sender.as_ref())
            .finish()
    }
}

impl FromRequestParts<ManualNotificationState> for PerSenderRateLimit {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &ManualNotificationState,
    ) -> Result<Self, Self::Rejection> {
        let Cached(authorization) = Cached::<
            MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
        >::from_request_parts(parts, state)
        .await
        .map_err(IntoResponse::into_response)?;

        Ok(Self {
            sender: authorization.authorization.user.macro_user_id,
        })
    }
}

/// What a manual notification opens.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManualNotificationLink {
    /// One of document, chat, channel, project, email_thread, agent_session,
    /// scheduled_action, database or form.
    pub entity_type: EntityType,
    /// The entity's id.
    pub entity_id: String,
}

/// A notification written by the caller.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendManualNotificationRequest {
    /// Who gets it; the caller when omitted. Anyone else must already be able
    /// to see `link`.
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub recipient_id: Option<MacroUserIdStr<'static>>,
    /// The headline, at most 120 characters.
    pub title: String,
    /// More detail, at most 1000 characters.
    #[serde(default)]
    pub body: Option<String>,
    /// What the notification opens; the caller must be able to see it.
    pub link: ManualNotificationLink,
}

pub(crate) fn router<S>(state: ManualNotificationState) -> Router<S> {
    Router::new()
        .route("/send", post(send_manual_notification))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            rate_limit_middleware::<
                ManualNotificationState,
                PerSenderRateLimit,
                ManualNotificationState,
            >,
        ))
        .with_state(state)
}

/// Send a notification the caller wrote, to themselves or to someone who can
/// already see what it links to. Delivered like any other notification and
/// subject to the recipient's notification preferences.
#[utoipa::path(
    post,
    operation_id = "send_manual_notification",
    path = "/v1/user_notifications/send",
    request_body = SendManualNotificationRequest,
    responses(
        (status = 204, description = "Queued for delivery"),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, description = "The recipient cannot see the link", body = ErrorResponse),
        (status = 404, description = "The link does not exist or the caller cannot see it", body = ErrorResponse),
        (status = 429, description = "Too many manual notifications from this sender"),
        (status = 500, body = ErrorResponse),
    )
)]
pub(crate) async fn send_manual_notification(
    State(state): State<ManualNotificationState>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(request): Json<SendManualNotificationRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse<'static>>)> {
    let user = authorization.authorization.user;

    state
        .notifications
        .send(
            ManualSender {
                user: user.macro_user_id,
                agent_id: user.agent_id,
            },
            ManualNotificationDraft {
                recipient: request.recipient_id,
                title: request.title,
                body: request.body,
                link: request
                    .link
                    .entity_type
                    .with_entity_string(request.link.entity_id),
            },
        )
        .await
        .map_err(error_response)?;

    Ok(StatusCode::NO_CONTENT)
}

fn error_response(error: ManualNotificationError) -> (StatusCode, Json<ErrorResponse<'static>>) {
    let status = match &error {
        ManualNotificationError::EmptyTitle
        | ManualNotificationError::TitleTooLong
        | ManualNotificationError::BodyTooLong
        | ManualNotificationError::UnlinkableEntity(_) => StatusCode::BAD_REQUEST,
        ManualNotificationError::LinkNotFound => StatusCode::NOT_FOUND,
        ManualNotificationError::RecipientCannotSeeLink => StatusCode::FORBIDDEN,
        ManualNotificationError::Internal(report) => {
            tracing::error!(error = ?report, "could not send a manual notification");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "could not send the notification".into(),
                }),
            );
        }
    };

    (
        status,
        Json(ErrorResponse {
            message: error.to_string().into(),
        }),
    )
}
