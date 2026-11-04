//! Thin guest HTTP adapters; the call and message domains own authorization.
use super::axum_router::MessageHttpError;
use crate::domain::ports::MessageError;
use crate::domain::service::guest_chat::{
    GuestChatApi, GuestChatMessage, GuestChatPage, GuestChatPost,
};
use axum::{
    Json, RequestPartsExt, Router,
    extract::{FromRequestParts, Path, State},
    http::{HeaderMap, header::AUTHORIZATION},
    routing::get,
};
use ip_extractor::ClientIp;
use rate_limit::{
    RateLimitConfig, RateLimitKey, RateLimitService,
    inbound::{RateLimitExtractable, RateLimitExtractor},
};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

/// Per-IP guest chat budget, separate from joining and leaving calls.
pub struct GuestChatBudget(ClientIp);
impl<S: Send + Sync> RateLimitExtractable<S> for GuestChatBudget {
    fn config() -> RateLimitConfig {
        RateLimitConfig {
            // Twenty open guest chats poll 24,000 times/hour behind one NAT;
            // leave headroom for sends, retries, and opening the panel.
            max_count: 30_000,
            window: Duration::from_mins(60),
        }
    }
    fn key(&self) -> RateLimitKey {
        RateLimitKey::builder(&"per-ip-guest-call-chat")
            .append(&self.0.origin_ip())
            .finish()
    }
}
impl<S: Send + Sync> FromRequestParts<S> for GuestChatBudget {
    type Rejection = <ClientIp as FromRequestParts<S>>::Rejection;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(parts.extract_with_state(state).await?))
    }
}
async fn limit<R: RateLimitService + Clone + Send + Sync + 'static>(
    _permit: RateLimitExtractor<GuestChatBudget, R>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    next.run(request).await
}

/// Mounted outside account auth; every request verifies an RTC guest credential.
pub fn router<R, S>(service: Arc<dyn GuestChatApi>, limiter: R) -> Router<S>
where
    R: RateLimitService + Clone + Send + Sync + 'static,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/{call_id}", get(read).post(post))
        .layer(axum::middleware::from_fn_with_state(limiter, limit::<R>))
        .with_state(service)
}

fn bearer(headers: &HeaderMap) -> Result<&str, MessageHttpError> {
    headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| !token.is_empty())
        .ok_or_else(|| MessageError::Forbidden.into())
}

/// Read the live call discussion as a verified guest.
#[utoipa::path(get, operation_id = "guest_call_chat_read", path = "/call/guest-chat/{call_id}", params(("call_id" = Uuid, Path)), responses((status = 200, body = GuestChatPage), (status = 403)))]
#[tracing::instrument(err, skip_all)]
pub async fn read(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path(call_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<GuestChatPage>, MessageHttpError> {
    Ok(Json(service.read(call_id, bearer(&headers)?).await?))
}

/// Append text to the same saved discussion used by account participants.
#[utoipa::path(post, operation_id = "guest_call_chat_post", path = "/call/guest-chat/{call_id}", params(("call_id" = Uuid, Path)), request_body = GuestChatPost, responses((status = 200, body = GuestChatMessage), (status = 403)))]
#[tracing::instrument(err, skip_all)]
pub async fn post(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path(call_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<GuestChatPost>,
) -> Result<Json<GuestChatMessage>, MessageHttpError> {
    Ok(Json(service.post(call_id, bearer(&headers)?, input).await?))
}
