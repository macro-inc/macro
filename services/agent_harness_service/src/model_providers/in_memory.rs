//! In-memory model discovery adapter.

use std::sync::Arc;

use agent_harness::domain::capability_discovery::{
    CapabilityProbeError, InMemoryCapabilityProbe, RawCapabilityProbe,
};
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

impl InMemoryCapabilityProbe for InMemoryModels {
    async fn probe(&self) -> Result<RawCapabilityProbe, CapabilityProbeError> {
        let Some(engine) = &self.engine else {
            return Ok(RawCapabilityProbe::Unsupported);
        };
        Ok(RawCapabilityProbe::Options(
            agent_inmem::domain::model_options::session_config_options(
                &self.current,
                engine.supported_models(),
                Default::default(),
            ),
        ))
    }
}
