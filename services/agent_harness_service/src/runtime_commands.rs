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

/// Drop a harness's runtime connection on whichever replica holds it, so its
/// daemon dials again (a Macro computer a team just took from the pool).
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct DisconnectRuntime {
    pub(crate) disconnect_harness: HarnessId,
}

/// Broadcast a [`DisconnectRuntime`] to every replica.
pub(crate) async fn publish_disconnect(
    redis: &redis::Client,
    harness: HarnessId,
) -> anyhow::Result<()> {
    let payload = serde_json::to_string(&DisconnectRuntime {
        disconnect_harness: harness,
    })?;
    redis
        .get_multiplexed_async_connection()
        .await?
        .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
        .await?;
    Ok(())
}

/// Hand an agent teammate's environment to whichever replica holds the
/// harness's runtime connection (an agent pool computer a team just took).
/// Its values are credentials; Debug shows none.
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct ApplyAgentRuntime {
    pub(crate) apply_agent_harness: HarnessId,
    pub(crate) environment: agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
}

/// Broadcast an [`ApplyAgentRuntime`] to every replica.
pub(crate) async fn publish_apply_agent(
    redis: &redis::Client,
    harness: HarnessId,
    environment: agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
) -> anyhow::Result<()> {
    let payload = zeroize::Zeroizing::new(serde_json::to_string(&ApplyAgentRuntime {
        apply_agent_harness: harness,
        environment,
    })?);
    redis
        .get_multiplexed_async_connection()
        .await?
        .publish::<_, _, ()>(COMMAND_CHANNEL, payload.as_str())
        .await?;
    Ok(())
}

/// Hands a harness's live runtime an agent environment; whether this
/// replica held the connection.
pub(crate) type ApplyAgent = Arc<
    dyn Fn(
            HarnessId,
            agent_runtime_protocol::domain::schema::v0::AgentEnvironment,
        ) -> futures::future::BoxFuture<'static, bool>
        + Send
        + Sync,
>;

// Untagged: a disconnect's and an agent hand-off's required fields appear in
// no other event, so they are tried first.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RuntimeBusEvent {
    Disconnect(DisconnectRuntime),
    ApplyAgent(ApplyAgentRuntime),
    Models(ModelProbeEvent),
    Command(Box<RuntimeCommandRequest>),
}

pub(crate) async fn consume_runtime_commands<Harness>(
    redis: redis::Client,
    replica: ReplicaId,
    connected: Arc<dyn Fn(HarnessId) -> bool + Send + Sync>,
    disconnect: Arc<dyn Fn(HarnessId) -> bool + Send + Sync>,
    apply_agent: ApplyAgent,
    harness_service: Arc<Harness>,
    ready: tokio::sync::watch::Sender<bool>,
    models: MacrodModels,
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
            RuntimeBusEvent::Disconnect(request) => {
                disconnect(request.disconnect_harness);
                continue;
            }
            RuntimeBusEvent::ApplyAgent(request) => {
                // Only the replica holding the connection sends it; the rest
                // find nothing to hand it to.
                let handed = apply_agent(request.apply_agent_harness, request.environment);
                probes.spawn(async move {
                    handed.await;
                });
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
