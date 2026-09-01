//! Signed webhook ingest: agent-trigger events delivered over HTTP, driving
//! sessions the same way a human driving the API by hand would - create,
//! dial, prompt.
//!
//! Non-2xx responses make the deliverer redeliver, so failures are only
//! signalled for work worth retrying: an undecodable payload or an event
//! this daemon has nothing to do for is acked and dropped.

use std::sync::Arc;

use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use macro_event_broker::Event;
use webhook_signature::{SIGNATURE_HEADER, TIMESTAMP_HEADER};

pub use crate::trigger::{Skipped, TriggerWork, WorkExecutor, trigger_to_work};

#[cfg(test)]
mod test;

/// State for the events route.
pub struct WebhookState<Executor> {
    /// Where translated work goes.
    pub executor: Executor,
    /// The webhook's signing secret, shared with the deliverer. Behind a lock
    /// because feed reconciliation replaces the feed - and its secret - when
    /// the bound-agent set changes.
    pub signing_secret: std::sync::Arc<std::sync::RwLock<String>>,
}

/// Build the router serving `POST /macro-events`.
pub fn webhook_router<Executor: WorkExecutor>(state: WebhookState<Executor>) -> Router {
    Router::new()
        .route("/macro-events", post(ingest::<Executor>))
        .with_state(Arc::new(state))
}

/// Verify, decode, translate, execute.
async fn ingest<Executor: WorkExecutor>(
    State(state): State<Arc<WebhookState<Executor>>>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    let (Some(timestamp), Some(signature)) = (header(TIMESTAMP_HEADER), header(SIGNATURE_HEADER))
    else {
        return StatusCode::UNAUTHORIZED;
    };
    let signing_secret = state
        .signing_secret
        .read()
        .expect("signing secret lock")
        .clone();
    if !webhook_signature::verify(&signing_secret, timestamp, &body, signature) {
        return StatusCode::UNAUTHORIZED;
    }

    let Ok(event) = serde_json::from_slice::<Event<AgentTriggerTopicEvent>>(&body) else {
        // The webhook service's validation probe is the everyday case here:
        // signed, not a trigger event, and answered 200 - which is exactly
        // what marks the feed valid. Anything else undecodable will not
        // improve on redelivery either: ack and drop.
        if serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("event").cloned())
            .is_some_and(|name| name == "webhook.validation.test")
        {
            tracing::info!("acknowledged the feed validation probe");
        } else {
            tracing::warn!("undecodable agent-trigger webhook payload; acked");
        }
        return StatusCode::OK;
    };

    match trigger_to_work(event.event) {
        Ok(work) => match state.executor.execute(work).await {
            Ok(()) => StatusCode::OK,
            Err(error) => {
                tracing::error!(error = ?error, "agent-trigger webhook work failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        },
        Err(skipped) => {
            tracing::debug!(?skipped, "agent-trigger webhook event skipped");
            StatusCode::OK
        }
    }
}
