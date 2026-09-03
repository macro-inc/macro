//! Redis implementation of [`CommandForwarder`].

use agent_session::domain::model::AgentSessionId;
use futures::StreamExt as _;
use harness_id::HarnessId;
use hmac::{Hmac, Mac as _};
use redis::AsyncCommands as _;
use sha2::{Digest as _, Sha256};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{CommandOutcome, HarnessCommand};
use crate::domain::ports::{CommandForwarder, CommandTarget};

#[cfg(test)]
mod test;

/// Broadcasts commands to the responsible harness replica over Redis.
#[derive(Clone)]
pub struct RedisCommandForwarder {
    redis: redis::Client,
    internal_api_key: String,
}

impl RedisCommandForwarder {
    /// Build a Redis command forwarder.
    pub fn new(redis: redis::Client, internal_api_key: String) -> Self {
        Self {
            redis,
            internal_api_key,
        }
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
            signature: String::new(),
        };
        let request = request.signed(&self.internal_api_key)?;
        let payload = serde_json::to_string(&request)
            .map_err(|error| forward_error("serialize command request", error))?;
        let mut publisher = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| forward_error("open command publisher", error))?;
        let subscribers = publisher
            .publish::<_, _, usize>(command_channel(&self.internal_api_key), payload)
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
                let response = serde_json::from_str::<SignedRuntimeCommandResponse>(&payload)
                    .map_err(|error| forward_error("deserialize command response", error))?;
                if !response.verify(&self.internal_api_key) {
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
        .map_err(|_| {
            HarnessError::Session(
                agent_session::domain::error::AgentSessionError::Disconnected(session),
            )
        })?
    }
}

pub(crate) fn command_channel(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let namespace = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("agent-harness.runtime-command.{namespace}")
}

pub(crate) fn response_channel(request_id: macro_uuid::Uuid) -> String {
    format!("agent-harness.runtime-command.response.{request_id}")
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct RuntimeCommandRequest {
    pub(crate) request_id: macro_uuid::Uuid,
    pub(crate) target: RuntimeCommandTarget,
    pub(crate) session: AgentSessionId,
    pub(crate) command: HarnessCommand,
    pub(crate) signature: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeCommandTarget {
    Replica(macro_uuid::Uuid),
    Harness(HarnessId),
}

impl RuntimeCommandRequest {
    fn signed(mut self, key: &str) -> Result<Self> {
        self.signature = sign_json(
            &(self.request_id, &self.target, self.session, &self.command),
            key,
        );
        Ok(self)
    }

    pub(crate) fn verify(&self, key: &str) -> bool {
        verify_json(
            &(self.request_id, &self.target, self.session, &self.command),
            &self.signature,
            key,
        )
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

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeCommandResponse {
    Completed(CommandOutcome),
    Failed(String),
    Declined,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct SignedRuntimeCommandResponse {
    response: RuntimeCommandResponse,
    signature: String,
}

impl SignedRuntimeCommandResponse {
    pub(crate) fn new(response: RuntimeCommandResponse, key: &str) -> Result<Self> {
        Ok(Self {
            signature: sign_json(&response, key),
            response,
        })
    }

    fn verify(&self, key: &str) -> bool {
        verify_json(&self.response, &self.signature, key)
    }
}

fn sign_json(value: &impl serde::Serialize, key: &str) -> String {
    let payload = serde_json::to_vec(value).expect("command bus values are serializable");
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC accepts any key");
    mac.update(&payload);
    base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        mac.finalize().into_bytes(),
    )
}

fn verify_json(value: &impl serde::Serialize, signature: &str, key: &str) -> bool {
    let Ok(payload) = serde_json::to_vec(value) else {
        return false;
    };
    let Ok(signature) =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, signature)
    else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key.as_bytes()) else {
        return false;
    };
    mac.update(&payload);
    mac.verify_slice(&signature).is_ok()
}

fn forward_error(operation: &'static str, error: impl std::fmt::Display) -> HarnessError {
    HarnessError::Forward(rootcause::report!("{operation}: {error}").into_dynamic())
}
