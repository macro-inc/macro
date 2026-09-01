//! Signed webhook ingest: agent-trigger events delivered over HTTP, driving
//! sessions the same way a human driving the API by hand would - create,
//! dial, prompt.
//!
//! Non-2xx responses make the deliverer redeliver, so failures are only
//! signalled for work worth retrying: an undecodable payload or an event
//! this daemon has nothing to do for is acked and dropped.

use std::sync::Arc;

use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentTriggerTopicEvent, ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use bot_id::BotId;
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use webhook_signature::{SIGNATURE_HEADER, TIMESTAMP_HEADER};

#[cfg(test)]
mod test;

/// What one trigger event asks this daemon to do.
///
/// Pure translation from the event vocabulary, split out so it can be tested
/// without HTTP or a live service - the same shape as the harness service's
/// own Kafka inbound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerWork {
    /// Open a session for a mention, serve it, and forward the mention as
    /// its first prompt.
    OpenAndPrompt {
        /// The mentioned agent the session runs for. One harness serves many
        /// agents, so the daemon must name the bot when creating the session.
        bot: BotId,
        /// Who asked; owns the session and authors the prompt.
        sender: MacroUserIdStr<'static>,
        /// Channel the mention was posted in.
        channel_id: Uuid,
        /// Thread the mention roots.
        thread_id: Uuid,
        /// The mentioning message.
        message_id: Uuid,
        /// The mention's text: the first prompt, and the announcement quote.
        content: String,
    },
    /// Forward a message into a session that already exists, serving it
    /// first if this daemon is not already. Just the prompt: the harness
    /// service announces the reply into its channel from the trigger event
    /// it observed.
    PromptExisting {
        /// The session to feed.
        session: AgentSessionId,
        /// Who sent the message.
        sender: MacroUserIdStr<'static>,
        /// The message's text.
        content: String,
    },
}

/// Why an event yielded no work. Only for logging - none of these are
/// errors, and the deliverer is acked either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skipped {
    /// The sender is not a user, so there is nobody to act for.
    NotFromUser,
    /// An event shape this daemon does not recognise yet - the trigger's
    /// vocabulary is non-exhaustive on purpose.
    Unrecognized,
}

/// Translate one trigger event into this daemon's work, or a reason to skip.
pub fn trigger_to_work(event: AgentTriggerTopicEvent) -> Result<TriggerWork, Skipped> {
    match event {
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
            let message = mentioned.message;
            let sender = message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(TriggerWork::OpenAndPrompt {
                bot: mentioned.bot_id,
                sender,
                channel_id: message.channel_id,
                // A top-level mention roots its own thread; a mention inside
                // a thread answers into that thread.
                thread_id: message.thread_id.unwrap_or(message.message_id),
                message_id: message.message_id,
                content: message.content,
            })
        }
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) => {
            let sender = metadata
                .message
                .sender
                .as_user()
                .cloned()
                .ok_or(Skipped::NotFromUser)?;
            Ok(TriggerWork::PromptExisting {
                session: metadata.session_id,
                sender,
                content: metadata.message.content,
            })
        }
        _ => Err(Skipped::Unrecognized),
    }
}

/// Executes translated work. The one capability the route needs, so tests
/// can drive it without a live service or harness.
pub trait WorkExecutor: Send + Sync + 'static {
    /// Do one event's work; an error is worth a redelivery.
    fn execute(
        &self,
        work: TriggerWork,
    ) -> impl Future<Output = Result<(), crate::dispatch::DispatchError>> + Send;
}

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
