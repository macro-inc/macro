//! Model discovery over the existing Redis runtime bus.

use std::sync::Arc;
use std::time::Duration;

use agent_harness::domain::model_load::{MacrodModelProbe, ModelProbeError, RawModelProbe};
use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::forward::COMMAND_CHANNEL;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_runtime_protocol::domain::schema::v0::ModelProbeResult;
use harness_id::HarnessId;
use redis::AsyncCommands as _;
use tokio::sync::broadcast;

#[cfg(test)]
mod test;

/// Probe events broadcast alongside existing runtime commands.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ModelProbeEvent {
    /// Whichever replica holds this socket should perform a local probe.
    ProbeModels { harness: HarnessId },
    /// A fresh observation available to every replica waiting on this harness.
    ModelsProbed {
        harness: HarnessId,
        result: ModelProbeResult,
    },
}

/// Macrod adapter using the shared runtime bus on every replica.
#[derive(Clone)]
pub struct MacrodModels {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    redis: redis::Client,
    observations: broadcast::Sender<(HarnessId, ModelProbeResult)>,
    timeout: Duration,
}

impl MacrodModels {
    /// Build the bus publisher and local observer shared with its consumer.
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        redis: redis::Client,
        timeout: Duration,
    ) -> Self {
        Self {
            runtimes,
            redis,
            observations: broadcast::channel(128).0,
            timeout,
        }
    }

    /// Handle a bus event independently of HTTP requests and other commands.
    pub(crate) async fn observe(&self, event: ModelProbeEvent) -> Result<(), ModelProbeError> {
        match event {
            ModelProbeEvent::ModelsProbed { harness, result } => {
                // Nobody waiting is normal: all replicas receive the event.
                let _ = self.observations.send((harness, result));
                Ok(())
            }
            ModelProbeEvent::ProbeModels { harness } => {
                let result =
                    match tokio::time::timeout(self.timeout, self.runtimes.probe_models(harness))
                        .await
                    {
                        // Only the socket-owning replica answers.
                        Ok(None) => return Ok(()),
                        Ok(Some(Ok(config_options))) => {
                            ModelProbeResult::Available { config_options }
                        }
                        Ok(Some(Err(error))) => ModelProbeResult::Error {
                            message: error.to_string(),
                        },
                        Err(_) => ModelProbeResult::Error {
                            message: "the ACP model probe timed out".to_owned(),
                        },
                    };
                self.publish(ModelProbeEvent::ModelsProbed { harness, result })
                    .await
            }
        }
    }

    async fn publish(&self, event: ModelProbeEvent) -> Result<(), ModelProbeError> {
        let payload = serde_json::to_string(&event)
            .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
        let mut connection = self
            .redis
            .get_multiplexed_async_connection()
            .await
            .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
        connection
            .publish::<_, _, ()>(COMMAND_CHANNEL, payload)
            .await
            .map_err(|error| ModelProbeError::Failed(error.to_string()))
    }
}

impl MacrodModelProbe for MacrodModels {
    async fn probe(&self, harness: HarnessId) -> Result<RawModelProbe, ModelProbeError> {
        // Observe first, so even an immediate answer cannot be missed.
        // Concurrent callers for this harness may use the same fresh observation.
        let mut observations = self.observations.subscribe();
        self.publish(ModelProbeEvent::ProbeModels { harness })
            .await?;
        loop {
            let (observed_harness, result) = observations
                .recv()
                .await
                .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
            if observed_harness != harness {
                continue;
            }
            return match result {
                ModelProbeResult::Available { config_options } => {
                    Ok(RawModelProbe::Options(config_options))
                }
                ModelProbeResult::Error { message } => Err(ModelProbeError::Failed(message)),
            };
        }
    }
}
