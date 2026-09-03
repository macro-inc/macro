//! Concrete outbound adapters for fresh model discovery.

use std::sync::Arc;

use agent_harness::domain::model_load::{
    CursorModelProbe, HarnessModelAccess, InMemoryModelProbe, MacrodModelProbe, ModelProbeError,
    RawModelProbe,
};
use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::cursor::CursorApiKeys;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_inmem::domain::engine::TurnEngine;
use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::model_options::cursor_model_config_options;
use cursor_cloud_agents::domain::ports::CursorAgents;
use harness_id::HarnessId;
use harnesses::domain::ports::{HarnessRepo, HarnessService};
use harnesses::domain::service::HarnessServiceImpl;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Visibility adapter backed by the harness domain's existing list policy.
pub struct VisibleHarnessAccess<Repo> {
    harnesses: HarnessServiceImpl<Repo>,
}

impl<Repo> VisibleHarnessAccess<Repo> {
    pub fn new(repo: Repo) -> Self {
        Self {
            harnesses: HarnessServiceImpl::new(repo),
        }
    }
}

impl<Repo> HarnessModelAccess for VisibleHarnessAccess<Repo>
where
    Repo: HarnessRepo,
{
    async fn can_use(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<bool, String> {
        self.harnesses
            .list_harnesses(caller.clone())
            .await
            .map(|visible| visible.iter().any(|candidate| candidate.id == harness))
            .map_err(|error| error.to_string())
    }
}

/// In-memory catalog adapter over the same engine used for turns.
pub struct InMemoryModels {
    engine: Option<Arc<dyn TurnEngine>>,
    current: String,
}

impl InMemoryModels {
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

/// Cursor catalog adapter resolving one caller's key for every request.
pub struct CursorModels<Keys> {
    keys: Keys,
    base_url: String,
}

impl<Keys> CursorModels<Keys> {
    pub fn new(keys: Keys, base_url: String) -> Self {
        Self { keys, base_url }
    }
}

impl<Keys> CursorModelProbe for CursorModels<Keys>
where
    Keys: CursorApiKeys,
{
    async fn probe(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> Result<RawModelProbe, ModelProbeError> {
        let config = self
            .keys
            .resolve(caller)
            .await
            .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
        let client = CursorClient::new(CursorConfig {
            api_key: ApiKey::new(config.key.expose()),
            base_url: self.base_url.clone(),
            model: None,
            starting_ref: "main".to_owned(),
            record_dir: None,
        })
        .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
        let models = client
            .list_models()
            .await
            .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
        let current = config
            .default_model_id
            .filter(|current| models.iter().any(|model| model.id == *current));
        Ok(RawModelProbe::Options(cursor_model_config_options(
            &models, current,
        )))
    }
}

/// Macrod adapter over the live runtime registry.
pub struct MacrodModels {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
}

impl MacrodModels {
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
