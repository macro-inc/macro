//! Redis command-bus listener composed around the harness domain service.

use std::sync::Arc;

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

pub(crate) async fn consume_runtime_commands<Harness>(
    redis: redis::Client,
    replica: ReplicaId,
    connected: Arc<dyn Fn(HarnessId) -> bool + Send + Sync>,
    harness_service: Arc<Harness>,
    ready: tokio::sync::watch::Sender<bool>,
) -> anyhow::Result<()>
where
    Harness: ForwardedCommands,
{
    let mut subscriber = redis.get_async_pubsub().await?;
    subscriber.subscribe(COMMAND_CHANNEL).await?;
    ready.send_replace(true);
    let mut requests = subscriber.into_on_message();
    while let Some(request) = requests.next().await {
        let payload: String = match request.get_payload() {
            Ok(payload) => payload,
            Err(error) => {
                tracing::warn!(error = ?error, "dropping malformed runtime command broadcast");
                continue;
            }
        };
        let request: RuntimeCommandRequest = match serde_json::from_str(&payload) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(error = ?error, "dropping malformed runtime command broadcast");
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
                    harness_service
                        .execute_forwarded(session, request.into_command())
                        .await
                        .inspect_err(|error| {
                            tracing::error!(error = ?error, %session, "forwarded command failed");
                        })
                        .ok();
                }
            }
            .instrument(span),
        );
    }
    anyhow::bail!("runtime command Redis subscription ended")
}
