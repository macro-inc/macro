//! Cursor model discovery adapter.

use agent_harness::domain::model_load::{CursorModelProbe, ModelProbeError, RawModelProbe};
use agent_harness::outbound::cursor::CursorApiKeys;
use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::model_options::cursor_model_config_options;
use cursor_cloud_agents::domain::ports::CursorAgents;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Cursor catalog adapter resolving one caller's key for every request.
pub struct CursorModels<Keys> {
    keys: Keys,
    base_url: String,
}

impl<Keys> CursorModels<Keys> {
    /// Build an adapter over the per-user key source and Cursor API.
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
