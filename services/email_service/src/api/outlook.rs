//! Microsoft Graph validation handshake and basic notification ingress.

use super::context::ApiContext;
use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use email::domain::mailbox::watches::{WatchHint, WatchNotification};
use serde::Deserialize;
use uuid::Uuid;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/webhook/{attempt}", post(handler))
        .layer(DefaultBodyLimit::max(256 * 1024))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Validation {
    validation_token: Option<String>,
}
#[derive(Deserialize)]
struct Batch {
    value: Vec<Notification>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Notification {
    subscription_id: String,
    client_state: Option<String>,
    lifecycle_event: Option<String>,
}

async fn handler(
    State(ctx): State<ApiContext>,
    Path(attempt): Path<Uuid>,
    Query(validation): Query<Validation>,
    body: Bytes,
) -> Response {
    if let Some(token) = validation.validation_token {
        if token.is_empty() || token.len() > 2048 {
            return StatusCode::BAD_REQUEST.into_response();
        }
        return (
            StatusCode::OK,
            [("content-type", "text/plain; charset=utf-8")],
            token,
        )
            .into_response();
    }
    let batch = match serde_json::from_slice::<Batch>(&body) {
        Ok(batch) if batch.value.len() <= 1000 => batch,
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    let notifications = batch
        .value
        .into_iter()
        .filter_map(|n| {
            Some(WatchNotification {
                subscription_id: n.subscription_id,
                client_state: n.client_state?,
                hint: match n.lifecycle_event.as_deref() {
                    None => WatchHint::Changed,
                    Some("missed") => WatchHint::Missed,
                    Some("subscriptionRemoved") => WatchHint::Removed,
                    Some("reauthorizationRequired") => WatchHint::Reauthorize,
                    _ => return None,
                },
            })
        })
        .collect();
    match ctx
        .mailbox_notifications
        .receive(attempt, notifications)
        .await
    {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}
