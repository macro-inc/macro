//! Thin guest HTTP adapters; the call and message domains own authorization.
use super::axum_router::MessageHttpError;
use super::axum_router::ReactionInput;
use crate::domain::models::Message;
use crate::domain::ports::MessageError;
use crate::domain::service::guest_chat::{
    GuestChatApi, GuestChatMessage, GuestChatPage, GuestChatPatch, GuestChatPost, GuestChatThread,
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
        .route("/{call_id}/thread", get(read_thread))
        .route("/{call_id}/messages", axum::routing::post(post_message))
        .route(
            "/{call_id}/messages/{message_id}",
            axum::routing::patch(patch_message).delete(delete_message),
        )
        .route(
            "/{call_id}/messages/{message_id}/reactions",
            axum::routing::post(react_message),
        )
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

/// Read the shared call thread with identities redacted.
#[utoipa::path(get, operation_id = "guest_call_chat_read_thread", path = "/call/guest-chat/{call_id}/thread", params(("call_id" = Uuid, Path)), responses((status = 200, body = GuestChatThread), (status = 403)))]
pub async fn read_thread(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path(call_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<GuestChatThread>, MessageHttpError> {
    Ok(Json(service.read_thread(call_id, bearer(&headers)?).await?))
}

/// Post a guest message to the shared call thread.
#[utoipa::path(post, operation_id = "guest_call_chat_post_message", path = "/call/guest-chat/{call_id}/messages", params(("call_id" = Uuid, Path)), request_body = GuestChatPost, responses((status = 200, body = Message), (status = 403)))]
pub async fn post_message(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path(call_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<GuestChatPost>,
) -> Result<Json<Message>, MessageHttpError> {
    Ok(Json(
        service
            .post_message(call_id, bearer(&headers)?, input)
            .await?,
    ))
}

/// Edit a message owned by this guest.
#[utoipa::path(patch, operation_id = "guest_call_chat_patch_message", path = "/call/guest-chat/{call_id}/messages/{message_id}", params(("call_id" = Uuid, Path), ("message_id" = Uuid, Path)), request_body = GuestChatPatch, responses((status = 200, body = Message), (status = 403)))]
pub async fn patch_message(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path((call_id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<GuestChatPatch>,
) -> Result<Json<Message>, MessageHttpError> {
    Ok(Json(
        service
            .patch_message(call_id, bearer(&headers)?, message_id, input)
            .await?,
    ))
}

/// Delete a message owned by this guest.
#[utoipa::path(delete, operation_id = "guest_call_chat_delete_message", path = "/call/guest-chat/{call_id}/messages/{message_id}", params(("call_id" = Uuid, Path), ("message_id" = Uuid, Path)), responses((status = 204), (status = 403)))]
pub async fn delete_message(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path((call_id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, MessageHttpError> {
    service
        .delete_message(call_id, bearer(&headers)?, message_id)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Add or remove this guest's reaction.
#[utoipa::path(post, operation_id = "guest_call_chat_react_message", path = "/call/guest-chat/{call_id}/messages/{message_id}/reactions", params(("call_id" = Uuid, Path), ("message_id" = Uuid, Path)), request_body = ReactionInput, responses((status = 200, body = Message), (status = 403)))]
pub async fn react_message(
    State(service): State<Arc<dyn GuestChatApi>>,
    Path((call_id, message_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<ReactionInput>,
) -> Result<Json<Message>, MessageHttpError> {
    Ok(Json(
        service
            .react_message(
                call_id,
                bearer(&headers)?,
                message_id,
                input.emoji,
                input.add,
                input.nonce,
            )
            .await?,
    ))
}
