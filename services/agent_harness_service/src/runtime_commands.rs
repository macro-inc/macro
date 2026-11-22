//! Redis command-bus listener composed around the harness domain service.

use std::sync::Arc;

use crate::model_providers::{MacrodModels, ModelProbeEvent};

use agent_harness::domain::service::ForwardedCommands;
use agent_harness::outbound::forward::{
    COMMAND_CHANNEL, RuntimeCommandRequest, RuntimeCommandTarget,
};
use agent_session::domain::model::ReplicaId;
use futures::StreamExt as _;
use harness_id::HarnessId;
use redis::AsyncCommands as _;
use redis::{ExistenceCheck, SetExpiry, SetOptions};
use tracing::Instrument as _;

#[cfg(test)]
mod test;

/// Ask whichever replica holds the harness's runtime connection to hand it
/// the agent teammate of `computer_id`. No credential travels on the bus:
/// that replica issues the agent's environment itself (each issue retires
/// the agent's previous key, so no other replica may) and sends it down
/// macrod's authenticated socket.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct DeliverAgent {
    pub(crate) deliver_agent_harness: HarnessId,
    pub(crate) computer_id: hosted_runtimes::domain::ids::ComputerId,
    pub(crate) generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
    /// W3C context of the operator's hand-off, so the delivery joins its trace.
    pub(crate) trace_context: std::collections::HashMap<String, String>,
}

impl DeliverAgent {
    /// A hand-off under the current span.
    pub(crate) fn new(
        harness: HarnessId,
        computer_id: hosted_runtimes::domain::ids::ComputerId,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
    ) -> Self {
        Self {
            deliver_agent_harness: harness,
            computer_id,
            generation,
            trace_context: agent_harness::outbound::forward::current_trace_context(),
        }
    }

    fn span(&self) -> tracing::Span {
        let span = tracing::info_span!(
            "computer.agent.deliver",
            otel.kind = "consumer",
            messaging.system = "redis",
            computer_id = %self.computer_id,
            harness_id = %self.deliver_agent_harness,
            generation = i64::from(self.generation.get()),
            delivered = tracing::field::Empty,
        );
        agent_harness::outbound::forward::adopt_trace_context(&span, &self.trace_context);
        span
    }
}

/// The runtime bus could not carry a message.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeBusError {
    #[error("could not encode a runtime bus message")]
    Encode(#[from] serde_json::Error),
    #[error("could not publish on the runtime bus")]
    Publish(#[from] redis::RedisError),
}

/// Broadcast a [`DeliverAgent`] to every replica.
pub(crate) async fn publish_deliver_agent(
    redis: &redis::Client,
    request: &DeliverAgent,
) -> Result<(), RuntimeBusError> {
    publish(redis, request).await
}

/// Broadcast a runtime bus message to every replica.
pub(crate) async fn publish(
    redis: &redis::Client,
    request: &impl serde::Serialize,
) -> Result<(), RuntimeBusError> {
    let payload = serde_json::to_string(request)?;
    redis
        .get_multiplexed_async_connection()
        .await?
        .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
        .await?;
    Ok(())
}

/// Sends an agent environment, with the setup trace the agent's start
/// joins, down a harness's runtime connection; whether this replica held it.
pub(crate) type SendAgent = Arc<
    dyn Fn(
            HarnessId,
            agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
            Option<String>,
        ) -> futures::future::BoxFuture<'static, bool>
        + Send
        + Sync,
>;

/// Carry out a [`DeliverAgent`] on this replica: only the one holding the
/// harness's connection issues the agent's environment, then sends it down
/// macrod's socket.
pub(crate) async fn deliver_agent_to_runtime(
    request: DeliverAgent,
    agents: Arc<dyn hosted_runtimes::domain::agent::AgentEnrollmentSource>,
    issued: Arc<IssuedAgents>,
    connection_of: Arc<
        dyn Fn(HarnessId) -> Option<agent_harness::domain::ports::RuntimeConnectionId>
            + Send
            + Sync,
    >,
    send: SendAgent,
) {
    let Some(connection) = connection_of(request.deliver_agent_harness) else {
        return;
    };
    let span = request.span();
    async move {
        let Some(environment) = issued
            .get_or_issue(
                request.computer_id,
                request.generation,
                connection,
                &*agents,
            )
            .await
        else {
            return;
        };
        let delivered = send(
            request.deliver_agent_harness,
            environment,
            hosted_runtimes::domain::telemetry::traceparent(),
        )
        .await;
        tracing::Span::current().record("delivered", delivered);
    }
    .instrument(span)
    .await;
}

/// How long this replica re-sends the environment it issued for a computer's
/// enrollment instead of issuing again: past the agent's start deadline.
const ISSUED_AGENT_KEPT_FOR: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// The agent environments this replica issued, so a repeated hand-off sends
/// the same credentials rather than rotating the key the starting agent
/// already holds. Kept only for [`ISSUED_AGENT_KEPT_FOR`]; values are wiped
/// when dropped.
#[derive(Default)]
pub(crate) struct IssuedAgents(tokio::sync::Mutex<std::collections::HashMap<Enrollment, Issued>>);

/// One creation of a computer's guest.
type Enrollment = (
    hosted_runtimes::domain::ids::ComputerId,
    hosted_runtimes::domain::enrollment::EnrollmentGeneration,
);

/// When and on which dial an environment was issued, and the environment.
type Issued = (
    std::time::Instant,
    agent_harness::domain::ports::RuntimeConnectionId,
    agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
);

impl IssuedAgents {
    /// The environment kept for the enrollment on this dial, issued first if
    /// none is. A redial issues again: another replica may have issued, and
    /// so revoked the kept key, while macrod was away. The lock spans
    /// `issue`, so hand-offs racing for one enrollment issue once.
    async fn get_or_issue(
        &self,
        computer_id: hosted_runtimes::domain::ids::ComputerId,
        generation: hosted_runtimes::domain::enrollment::EnrollmentGeneration,
        connection: agent_harness::domain::ports::RuntimeConnectionId,
        agents: &dyn hosted_runtimes::domain::agent::AgentEnrollmentSource,
    ) -> Option<agent_runtime_protocol::domain::schema::v0::AgentEnvironment> {
        let mut issued = self.0.lock().await;
        issued.retain(|_, (at, _, _)| at.elapsed() < ISSUED_AGENT_KEPT_FOR);
        if let Some((_, kept_on, environment)) = issued.get(&(computer_id, generation))
            && *kept_on == connection
        {
            return Some(environment.clone());
        }
        let enrollment = match agents.issue(computer_id, generation).await {
            Ok(Some(enrollment)) => enrollment,
            Ok(None) => {
                tracing::warn!("the computer runs no agent; nothing to hand over");
                return None;
            }
            Err(error) => {
                tracing::warn!(?error, "could not issue the agent's environment");
                return None;
            }
        };
        let environment = agent_runtime_protocol::domain::schema::v0::AgentEnvironment(
            enrollment
                .env
                .expose()
                .iter()
                .map(|(key, value)| (key.as_str().to_owned(), value.clone()))
                .collect(),
        );
        issued.insert(
            (computer_id, generation),
            (std::time::Instant::now(), connection, environment.clone()),
        );
        Some(environment)
    }
}

// Untagged: an agent hand-off's, a teammate change's and a host recheck's
// required fields appear in no other event, so they are tried first.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RuntimeBusEvent {
    DeliverAgent(DeliverAgent),
    TeammatesChanged(crate::teammates::TeammatesChanged),
    TeammateHostRecheck(crate::teammates::TeammateHostRecheck),
    Models(ModelProbeEvent),
    Command(Box<RuntimeCommandRequest>),
}

#[expect(
    clippy::too_many_arguments,
    reason = "each is a separate capability of the bus consumer; tests pass them one by one"
)]
pub(crate) async fn consume_runtime_commands<Harness>(
    redis: redis::Client,
    replica: ReplicaId,
    connected: Arc<dyn Fn(HarnessId) -> bool + Send + Sync>,
    harness_service: Arc<Harness>,
    ready: tokio::sync::watch::Sender<bool>,
    models: MacrodModels,
    deliver_agent: Arc<
        dyn Fn(DeliverAgent) -> futures::future::BoxFuture<'static, ()> + Send + Sync,
    >,
    teammates: Option<Arc<crate::teammates::TeammateDelivery>>,
) -> anyhow::Result<()>
where
    Harness: ForwardedCommands,
{
    let mut subscriber = redis.get_async_pubsub().await?;
    subscriber.subscribe(COMMAND_CHANNEL).await?;
    ready.send_replace(true);
    let mut requests = subscriber.into_on_message();
    let mut probes = tokio::task::JoinSet::new();
    loop {
        let request = tokio::select! {
            request = requests.next() => match request {
                Some(request) => request,
                None => break,
            },
            result = probes.join_next(), if !probes.is_empty() => {
                if let Some(Err(error)) = result {
                    tracing::error!(error = ?error, "runtime model observer task failed");
                }
                continue;
            }
        };
        let payload: String = match request.get_payload() {
            Ok(payload) => payload,
            Err(error) => {
                tracing::warn!(error = ?error, "dropping malformed runtime command broadcast");
                continue;
            }
        };
        let event: RuntimeBusEvent = match serde_json::from_str(&payload) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(error = ?error, "dropping malformed runtime command broadcast");
                continue;
            }
        };
        let request = match event {
            RuntimeBusEvent::DeliverAgent(request) => {
                // Only the replica holding the connection delivers; the rest
                // find nothing to hand it to.
                probes.spawn(deliver_agent(request));
                continue;
            }
            RuntimeBusEvent::TeammatesChanged(changed) => {
                // Only the replica holding the machine's socket reconciles.
                if let Some(teammates) = teammates.clone() {
                    let span = changed.span();
                    probes.spawn(
                        async move {
                            teammates
                                .installs_changed(changed.teammates_changed_harness)
                                .await;
                        }
                        .instrument(span),
                    );
                }
                continue;
            }
            RuntimeBusEvent::TeammateHostRecheck(recheck) => {
                // Only the replica holding the machine's socket sends it.
                if let Some(teammates) = teammates.clone() {
                    let span = recheck.span();
                    probes.spawn(
                        async move {
                            teammates.recheck_host(recheck.recheck_teammate_host).await;
                        }
                        .instrument(span),
                    );
                }
                continue;
            }
            RuntimeBusEvent::Command(request) => *request,
            RuntimeBusEvent::Models(event) => {
                let models = models.clone();
                probes.spawn(async move {
                    models
                        .observe(event)
                        .await
                        .inspect_err(|error| {
                            tracing::error!(error = ?error, "runtime model bus event failed");
                        })
                        .ok();
                });
                continue;
            }
        };
        let redis = redis.clone();
        let harness_service = Arc::clone(&harness_service);
        let connected = Arc::clone(&connected);
        let span = request.processing_span();
        tokio::spawn(
            async move {
                let request_id = request.request_id();
                let session = request.session();
                let selected = match request.target() {
                    RuntimeCommandTarget::Replica(target) => target == replica.as_uuid(),
                    RuntimeCommandTarget::Harness(harness) if connected(harness) => {
                        let mut connection = match redis.get_multiplexed_async_connection().await {
                            Ok(connection) => connection,
                            Err(error) => {
                                tracing::error!(error = ?error, "failed to claim a harness command");
                                return;
                            }
                        };
                        connection
                            .set_options::<_, _, Option<String>>(
                                format!("agent-harness.runtime-command.claim.{request_id}"),
                                replica.as_uuid().to_string(),
                                SetOptions::default()
                                    .conditional_set(ExistenceCheck::NX)
                                    .with_expiration(SetExpiry::EX(120)),
                            )
                            .await
                            .is_ok_and(|result| result.is_some())
                    }
                    RuntimeCommandTarget::Harness(_) => false,
                };
                if selected {
                    // The forwarding replica answered its caller the moment it
                    // published, so this is the only record that the command
                    // arrived anywhere and what became of it. Logged on
                    // success too: a session whose queue never drains is
                    // debugged by asking whether its commands reached the
                    // replica that manages it.
                    match harness_service
                        .execute_forwarded(session, request.into_command())
                        .await
                    {
                        Ok(outcome) => {
                            tracing::info!(%session, ?outcome, "executed a forwarded command");
                        }
                        Err(error) => {
                            tracing::error!(error = ?error, %session, "forwarded command failed");
                        }
                    }
                }
            }
            .instrument(span),
        );
    }
    anyhow::bail!("runtime command Redis subscription ended")
}
