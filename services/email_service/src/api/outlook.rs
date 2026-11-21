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
use email_api_client::domain::models::ProviderId;
use serde::Deserialize;
use uuid::Uuid;

#[cfg(test)]
mod test;

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
    resource_data: Option<ResourceData>,
}
/// The changed item of a change notification: for `me/messages`, the
/// message's immutable id, as every Graph request asks for immutable ids.
#[derive(Deserialize)]
struct ResourceData {
    id: Option<String>,
}
impl Notification {
    /// The message a change notification names; a lifecycle event names none.
    fn message(&self) -> Option<ProviderId> {
        let id = self.resource_data.as_ref()?.id.as_deref()?;
        ProviderId::new(id).ok()
    }
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
    // The email e2e coverage list reads the webhook's cases from this match
    // (`crates/email_e2e/coverage/sources.toml`), so it stays in the handler.
    let notifications = batch
        .value
        .into_iter()
        .filter_map(|n| {
            let message = n.message();
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
                message,
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
