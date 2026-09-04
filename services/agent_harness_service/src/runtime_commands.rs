//! Redis command-bus listener composed around the harness domain service.

use std::sync::Arc;

use agent_harness::domain::service::ForwardedCommands;
use agent_harness::outbound::forward::{
    RuntimeCommandRequest, RuntimeCommandResponse, RuntimeCommandTarget,
    SignedRuntimeCommandResponse, command_channel, response_channel,
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
    internal_api_key: String,
    connected: Arc<dyn Fn(HarnessId) -> bool + Send + Sync>,
    harness_service: Arc<Harness>,
    ready: tokio::sync::watch::Sender<bool>,
) -> anyhow::Result<()>
where
    Harness: ForwardedCommands,
{
    let mut subscriber = redis.get_async_pubsub().await?;
    subscriber
        .subscribe(command_channel(&internal_api_key))
        .await?;
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
        if !request.verify(&internal_api_key) {
            tracing::warn!("dropping unauthenticated runtime command broadcast");
            continue;
        }
        let redis = redis.clone();
        let harness_service = Arc::clone(&harness_service);
        let connected = Arc::clone(&connected);
        let internal_api_key = internal_api_key.clone();
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
                let response = if selected {
                    match harness_service
                        .execute_forwarded(session, request.into_command())
                        .await
                    {
                        Ok(outcome) => RuntimeCommandResponse::Completed(outcome),
                        Err(error) => RuntimeCommandResponse::Failed(error.to_string()),
                    }
                } else {
                    RuntimeCommandResponse::Declined
                };
                let publish = async {
                    let response = SignedRuntimeCommandResponse::new(
                        request_id,
                        response,
                        &internal_api_key,
                    );
                    let response = serde_json::to_string(&response)?;
                    let mut publisher = redis.get_multiplexed_async_connection().await?;
                    publisher
                        .publish::<_, _, ()>(response_channel(request_id), response)
                        .await?;
                    anyhow::Ok(())
                };
                if let Err(error) = publish.await {
                    tracing::error!(error = ?error, "failed to publish runtime command response");
                }
            }
            .instrument(span),
        );
    }
    Ok(())
}
