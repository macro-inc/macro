//! Google Calendar push notification webhook.
//!
//! Google delivers content-free notifications here for every calendar with
//! an open `events.watch` channel. The handler verifies the shared channel
//! token minted at channel creation, then re-arms the watched inbox's sync
//! job; the regular poll remains the backstop for dropped notifications, so
//! unmatched or failed notifications are acknowledged rather than retried.

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use subtle::ConstantTimeEq;

use crate::api::context::ApiContext;
use email_service::pubsub::context::calendar_watch_config;

/// Build the unauthenticated watch notification router.
pub fn router() -> Router<ApiContext> {
    Router::new().route("/notifications", post(handler))
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

#[tracing::instrument(skip_all)]
async fn handler(State(ctx): State<ApiContext>, headers: HeaderMap) -> StatusCode {
    let Some(config) = calendar_watch_config() else {
        return StatusCode::NOT_FOUND;
    };

    let valid = header(&headers, "x-goog-channel-token")
        .is_some_and(|token| bool::from(token.as_bytes().ct_eq(config.token.as_bytes())));

    if !valid {
        return StatusCode::FORBIDDEN;
    }

    if header(&headers, "x-goog-resource-state") == Some("sync") {
        return StatusCode::OK;
    }

    let (Some(channel_id), Some(resource_id)) = (
        header(&headers, "x-goog-channel-id"),
        header(&headers, "x-goog-resource-id"),
    ) else {
        return StatusCode::BAD_REQUEST;
    };
    match ctx
        .calendar_service
        .handle_watch_notification(channel_id, resource_id)
        .await
    {
        Ok(matched) => {
            if !matched {
                tracing::debug!(
                    channel_id,
                    "calendar notification matched no active channel"
                );
            }
        }
        Err(error) => {
            tracing::warn!(error = ?error, channel_id, "failed to apply calendar watch notification");
        }
    }
    StatusCode::OK
}
