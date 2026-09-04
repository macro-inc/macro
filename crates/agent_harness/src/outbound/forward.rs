//! Redis implementation of [`CommandForwarder`].

use agent_session::domain::model::AgentSessionId;
use futures::StreamExt as _;
use harness_id::HarnessId;
use opentelemetry::propagation::{Extractor, Injector};
use redis::AsyncCommands as _;
use std::collections::BTreeMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CommandOutcome, HarnessCommand};
use crate::domain::ports::{CommandForwarder, CommandTarget};

#[cfg(test)]
mod test;

/// Broadcasts commands to the responsible harness replica over Redis.
#[derive(Clone)]
pub struct RedisCommandForwarder {
    redis: redis::Client,
}

impl RedisCommandForwarder {
    /// Build a Redis command forwarder.
    pub fn new(redis: redis::Client) -> Self {
        Self { redis }
    }
}

impl CommandForwarder for RedisCommandForwarder {
    async fn forward(
        &self,
        session: AgentSessionId,
        command: HarnessCommand,
        target: CommandTarget,
    ) -> Result<CommandOutcome> {
        let request_id = macro_uuid::Uuid::new_v4();
        let response_channel = response_channel(request_id);
        let mut subscriber = self
            .redis
            .get_async_pubsub()
            .await
            .map_err(|error| forward_error("open response subscription", error))?;
        subscriber
            .subscribe(&response_channel)
            .await
            .map_err(|error| forward_error("subscribe for command response", error))?;
        let request = RuntimeCommandRequest {
            request_id,
            target: RuntimeCommandTarget::from(target),
            session,
            command,
            trace_context: current_trace_context(),
        };
        let payload = serde_json::to_string(&request)
            .map_err(|error| forward_error("serialize command request", error))?;
        let mut publisher = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| forward_error("open command publisher", error))?;
        let subscribers = publisher
            .publish::<_, _, usize>(COMMAND_CHANNEL, payload)
            .await
            .map_err(|error| forward_error("publish command request", error))?;
        if subscribers == 0 {
            return Err(HarnessError::Disconnected(session));
        }
        let mut responses = subscriber.into_on_message();
        tokio::time::timeout(std::time::Duration::from_secs(120), async {
            let mut declined = 0;
            while let Some(response) = responses.next().await {
                let payload: String = response
                    .get_payload()
                    .map_err(|error| forward_error("read command response", error))?;
                let response = serde_json::from_str::<RuntimeCommandResponseEnvelope>(&payload)
                    .map_err(|error| forward_error("deserialize command response", error))?;
                if response.request_id != request_id {
                    continue;
                }
                match response.response {
                    RuntimeCommandResponse::Completed(outcome) => return Ok(outcome),
                    RuntimeCommandResponse::Failed(message) => {
                        return Err(HarnessError::Forward(
                            rootcause::report!(message).into_dynamic(),
                        ));
                    }
                    RuntimeCommandResponse::Declined => {
                        declined += 1;
                        if declined >= subscribers {
                            return Err(HarnessError::Disconnected(session));
                        }
                    }
                }
            }
            Err(HarnessError::Disconnected(session))
        })
        .await
        .map_err(|_| HarnessError::Disconnected(session))?
    }
}

/// Redis channel broadcasting runtime commands to every harness replica.
pub const COMMAND_CHANNEL: &str = "agent-harness.runtime-commands";

/// Return the private response channel for one command request.
pub fn response_channel(request_id: macro_uuid::Uuid) -> String {
    format!("agent-harness.runtime-command.response.{request_id}")
}

/// A command broadcast received from another replica.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RuntimeCommandRequest {
    request_id: macro_uuid::Uuid,
    target: RuntimeCommandTarget,
    session: AgentSessionId,
    command: HarnessCommand,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    trace_context: BTreeMap<String, String>,
}

/// The process-local destination selected by the command sender.
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandTarget {
    /// A specific session-owning replica.
    Replica(macro_uuid::Uuid),
    /// Whichever replica currently holds this harness runtime connection.
    Harness(HarnessId),
}

impl RuntimeCommandRequest {
    /// The unique ID used to claim and answer this command.
    #[must_use]
    pub fn request_id(&self) -> macro_uuid::Uuid {
        self.request_id
    }

    /// The replica or harness connection selected for execution.
    #[must_use]
    pub fn target(&self) -> RuntimeCommandTarget {
        self.target
    }

    /// The session receiving the command.
    #[must_use]
    pub fn session(&self) -> AgentSessionId {
        self.session
    }

    /// Consume the transport envelope and return its domain command.
    #[must_use]
    pub fn into_command(self) -> HarnessCommand {
        self.command
    }

    /// Create a consumer span parented to the sender's propagated context.
    #[must_use]
    pub fn processing_span(&self) -> tracing::Span {
        runtime_command_span(self)
    }
}

impl From<CommandTarget> for RuntimeCommandTarget {
    fn from(target: CommandTarget) -> Self {
        match target {
            CommandTarget::Replica(replica) => Self::Replica(replica.as_uuid()),
            CommandTarget::Harness(harness) => Self::Harness(harness),
        }
    }
}

/// The result sent by each replica that observed a command broadcast.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCommandResponse {
    /// The selected replica executed the command.
    Completed(CommandOutcome),
    /// The selected replica attempted execution and failed.
    Failed(String),
    /// This replica was not responsible for the command.
    Declined,
}

/// A response correlated to one command request.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RuntimeCommandResponseEnvelope {
    request_id: macro_uuid::Uuid,
    response: RuntimeCommandResponse,
}

impl RuntimeCommandResponseEnvelope {
    /// Correlate a response to its command request.
    #[must_use]
    pub fn new(request_id: macro_uuid::Uuid, response: RuntimeCommandResponse) -> Self {
        Self {
            request_id,
            response,
        }
    }
}

#[derive(Default)]
struct TraceContext(BTreeMap<String, String>);

impl Injector for TraceContext {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_owned(), value);
    }
}

impl Extractor for TraceContext {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(String::as_str).collect()
    }
}

fn current_trace_context() -> BTreeMap<String, String> {
    let context = tracing::Span::current().context();
    let mut carrier = TraceContext::default();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    carrier.0
}

fn runtime_command_span(request: &RuntimeCommandRequest) -> tracing::Span {
    let span = tracing::info_span!(
        "redis.process",
        otel.kind = "consumer",
        messaging.system = "redis",
        messaging.operation.name = "process",
        messaging.operation.type = "process",
        messaging.message.id = %request.request_id,
        agent.session.id = %request.session,
    );
    let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract(&TraceContext(request.trace_context.clone()))
    });
    let _ = span.set_parent(parent);
    span
}

fn forward_error(operation: &'static str, error: impl std::fmt::Display) -> HarnessError {
    HarnessError::Forward(rootcause::report!("{operation}: {error}").into_dynamic())
}
