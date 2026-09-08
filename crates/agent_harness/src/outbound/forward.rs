//! Redis implementation of [`CommandForwarder`].

use agent_session::domain::model::AgentSessionId;
use harness_id::HarnessId;
use redis::AsyncCommands as _;
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CommandOutcome, HarnessCommand};
use crate::domain::ports::{CommandForwarder, CommandTarget};

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
        let request = RuntimeCommandRequest {
            request_id: macro_uuid::Uuid::new_v4(),
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
        publisher
            .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
            .await
            .map_err(|error| forward_error("publish command request", error))?;
        Ok(CommandOutcome::Completed)
    }
}

/// Redis channel broadcasting runtime commands to every harness replica.
pub const COMMAND_CHANNEL: &str = "agent-harness.runtime-commands";

/// A command broadcast received from another replica.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RuntimeCommandRequest {
    request_id: macro_uuid::Uuid,
    target: RuntimeCommandTarget,
    session: AgentSessionId,
    command: HarnessCommand,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    trace_context: HashMap<String, String>,
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
    /// The unique ID used to claim and trace this command.
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

fn current_trace_context() -> HashMap<String, String> {
    let context = tracing::Span::current().context();
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    carrier
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
        propagator.extract(&request.trace_context)
    });
    let _ = span.set_parent(parent);
    span
}

fn forward_error(operation: &'static str, error: impl std::fmt::Display) -> HarnessError {
    HarnessError::Forward(rootcause::report!("{operation}: {error}").into_dynamic())
}
