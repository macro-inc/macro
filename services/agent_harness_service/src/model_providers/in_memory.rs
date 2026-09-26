//! In-memory model discovery adapter.

use agent_harness::domain::capability_discovery::{CapabilityProbeError, RawCapabilityProbe};
use std::sync::Arc;

use agent_harness::domain::model_load::{InMemoryModelProbe, ModelProbeError, RawModelProbe};
use agent_inmem::domain::engine::TurnEngine;

/// In-memory catalog adapter over the same engine used for turns.
pub struct InMemoryModels {
    engine: Option<Arc<dyn TurnEngine>>,
    current: String,
}

impl InMemoryModels {
    /// Build an adapter over the optional in-memory engine.
    pub fn new(engine: Option<Arc<dyn TurnEngine>>, current: String) -> Self {
        Self { engine, current }
    }
}

impl InMemoryModelProbe for InMemoryModels {
    async fn probe(&self) -> Result<RawModelProbe, ModelProbeError> {
        let Some(engine) = &self.engine else {
            return Ok(RawModelProbe::Unsupported);
        };
        Ok(RawModelProbe::Options(
            agent_inmem::domain::model_options::model_config_options(
                &self.current,
                engine.supported_models(),
            ),
        ))
    }
}

impl agent_harness::domain::capability_discovery::CapabilityProbe for InMemoryModels {
    type Target = ();
    async fn probe(
        &self,
        _: &(),
        model: Option<&str>,
    ) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        let Some(engine) = &self.engine else {
            return Ok(RawCapabilityProbe::Unsupported);
        };
        let current = model.unwrap_or(&self.current);
        if !engine.supported_models().contains(&current) {
            return Err(CapabilityProbeError::Failed("unsupported model".to_owned()));
        }
        Ok(RawCapabilityProbe::Options(
            agent_inmem::domain::model_options::model_config_options(
                current,
                engine.supported_models(),
            ),
        ))
    }
}
