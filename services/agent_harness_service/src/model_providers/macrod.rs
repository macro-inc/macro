//! Registered macrod model discovery adapter.

use std::sync::Arc;

use agent_harness::domain::model_load::{MacrodModelProbe, ModelProbeError, RawModelProbe};
use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use harness_id::HarnessId;

#[cfg(test)]
mod test;

/// Macrod adapter over the live runtime registry.
pub struct MacrodModels {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
}

impl MacrodModels {
    /// Build an adapter over the live harness runtime registry.
    pub fn new(runtimes: Arc<RuntimeRegistry<GatewaySender>>) -> Self {
        Self { runtimes }
    }
}

impl MacrodModelProbe for MacrodModels {
    async fn probe(&self, harness: HarnessId) -> Result<RawModelProbe, ModelProbeError> {
        match self.runtimes.probe_models(harness).await {
            None => Err(ModelProbeError::Disconnected),
            Some(Ok(options)) => Ok(RawModelProbe::Options(options)),
            Some(Err(error)) => Err(ModelProbeError::Failed(error.to_string())),
        }
    }
}
