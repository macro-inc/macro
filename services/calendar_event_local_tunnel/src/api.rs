//! HTTP surface: Google's webhook in, subscriber SSE out.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use calendar_watch_relay::{RelayedWatchNotification, secrets_match};
use futures::StreamExt;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;

use crate::registry::RelayRegistry;

/// Shared handler state.
#[derive(Clone)]
pub struct ApiContext {
    /// Live subscriptions by channel token.
    pub registry: RelayRegistry,
    /// Shared secret subscribers must present.
    pub secret: Arc<String>,
}

/// Build the service router.
pub fn router(state: ApiContext) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/calendar/notifications", post(notifications))
        .route("/calendar/relay/subscribe", get(subscribe))
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

/// Google's webhook. Deliveries are routed purely by channel token; the
/// token was minted by the local stack that opened the channel, so a
/// delivery nobody subscribes to (a stray from a torn-down stack, or a
/// probe with an invented token) is acknowledged and dropped.
#[tracing::instrument(skip_all)]
async fn notifications(State(ctx): State<ApiContext>, headers: HeaderMap) -> StatusCode {
    let Some(token) = header(&headers, "x-goog-channel-token") else {
        return StatusCode::FORBIDDEN;
    };
    let (Some(state), Some(channel_id), Some(resource_id)) = (
        header(&headers, "x-goog-resource-state"),
        header(&headers, "x-goog-channel-id"),
        header(&headers, "x-goog-resource-id"),
    ) else {
        return StatusCode::BAD_REQUEST;
    };
    let notification = RelayedWatchNotification {
        state: state.to_owned(),
        channel_id: channel_id.to_owned(),
        resource_id: resource_id.to_owned(),
    };
    let delivered = ctx.registry.publish(token, notification);
    if delivered == 0 {
        tracing::debug!(channel_id, "calendar notification matched no subscriber");
    }
    StatusCode::OK
}

/// Stream relayed notifications for one channel token over SSE.
///
/// Subscribers authenticate with the shared relay secret; the stream then
/// carries only deliveries addressed to the presented token, so one local
/// stack can never observe another's notifications.
#[tracing::instrument(skip_all)]
async fn subscribe(State(ctx): State<ApiContext>, headers: HeaderMap) -> Response {
    let Some(secret) = header(&headers, "x-relay-secret") else {
        return StatusCode::FORBIDDEN.into_response();
    };
    if !secrets_match(secret, &ctx.secret) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(token) = header(&headers, "x-relay-token") else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let stream =
        BroadcastStream::new(ctx.registry.subscribe(token)).filter_map(|delivery| async move {
            match delivery {
                Ok(notification) => Some(Event::default().json_data(&notification)),
                // Dropped deliveries degrade to the subscriber's poll backstop.
                Err(BroadcastStreamRecvError::Lagged(dropped)) => {
                    tracing::warn!(dropped, "relay subscriber lagged; deliveries dropped");
                    None
                }
            }
        });
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

#[cfg(test)]
mod test;
