//! Redis implementation of [`CommandForwarder`].

use agent_session::domain::model::{AgentSessionId, ReplicaId};
use futures::StreamExt as _;
use harness_id::HarnessId;
use redis::AsyncCommands as _;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CommandOutcome, HarnessCommand};
use crate::domain::ports::CommandForwarder;

#[cfg(test)]
mod test;

/// Broadcasts commands to the responsible harness replica over Redis.
#[derive(Clone)]
pub struct RedisCommandForwarder {
    redis: redis::Client,
    replica: ReplicaId,
}

impl RedisCommandForwarder {
    /// Build a Redis command forwarder.
    pub fn new(redis: redis::Client, replica: ReplicaId) -> Self {
        Self { redis, replica }
    }
}

impl CommandForwarder for RedisCommandForwarder {
    async fn forward(
        &self,
        session: AgentSessionId,
        command: HarnessCommand,
        harness: Option<HarnessId>,
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
            origin: self.replica.as_uuid(),
            harness,
            session,
            command,
        };
        let payload = serde_json::to_string(&request)
            .map_err(|error| forward_error("serialize command request", error))?;
        let mut publisher = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| forward_error("open command publisher", error))?;
        publisher
            .publish::<_, _, ()>(RUNTIME_COMMAND_CHANNEL, payload)
            .await
            .map_err(|error| forward_error("publish command request", error))?;
        let mut responses = subscriber.into_on_message();
        tokio::time::timeout(std::time::Duration::from_secs(120), async {
            let mut last_error = None;
            while let Some(response) = responses.next().await {
                let payload: String = response
                    .get_payload()
                    .map_err(|error| forward_error("read command response", error))?;
                match serde_json::from_str::<RuntimeCommandResponse>(&payload)
                    .map_err(|error| forward_error("deserialize command response", error))?
                    .result
                {
                    Ok(outcome) => return Ok(outcome),
                    Err(message) => last_error = Some(message),
                }
            }
            Err(
                last_error.map_or(HarnessError::Disconnected(session), |message| {
                    HarnessError::Forward(rootcause::report!(message).into_dynamic())
                }),
            )
        })
        .await
        .map_err(|_| {
            HarnessError::Session(
                agent_session::domain::error::AgentSessionError::Disconnected(session),
            )
        })?
    }
}

const RUNTIME_COMMAND_CHANNEL: &str = "agent-harness.runtime-command";

fn response_channel(request_id: macro_uuid::Uuid) -> String {
    format!("agent-harness.runtime-command.response.{request_id}")
}

#[derive(serde::Serialize, serde::Deserialize)]
struct RuntimeCommandRequest {
    request_id: macro_uuid::Uuid,
    origin: macro_uuid::Uuid,
    harness: Option<HarnessId>,
    session: AgentSessionId,
    command: HarnessCommand,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct RuntimeCommandResponse {
    result: std::result::Result<CommandOutcome, String>,
}

fn forward_error(operation: &'static str, error: impl std::fmt::Display) -> HarnessError {
    HarnessError::Forward(rootcause::report!("{operation}: {error}").into_dynamic())
}

/// Consume runtime command broadcasts on every replica.
pub async fn consume_runtime_commands<Harness>(
    redis: redis::Client,
    replica: ReplicaId,
    harness_service: std::sync::Arc<Harness>,
    ready: tokio::sync::watch::Sender<bool>,
) -> anyhow::Result<()>
where
    Harness: crate::domain::service::ForwardedCommands,
{
    let mut subscriber = redis.get_async_pubsub().await?;
    subscriber.subscribe(RUNTIME_COMMAND_CHANNEL).await?;
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
        let harness_service = std::sync::Arc::clone(&harness_service);
        tokio::spawn(async move {
            let Some(result) = harness_service
                .execute_forwarded(
                    request.session,
                    request.command,
                    request.harness,
                    request.origin == replica.as_uuid(),
                )
                .await
            else {
                return;
            };
            let result = result.map_err(|error| error.to_string());
            let publish = async {
                let response = serde_json::to_string(&RuntimeCommandResponse { result })?;
                let mut publisher = redis.get_multiplexed_async_connection().await?;
                publisher
                    .publish::<_, _, ()>(response_channel(request.request_id), response)
                    .await?;
                anyhow::Ok(())
            };
            if let Err(error) = publish.await {
                tracing::error!(error = ?error, "failed to publish runtime command response");
            }
        });
    }
    Ok(())
}
