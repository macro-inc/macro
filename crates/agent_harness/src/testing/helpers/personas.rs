//! Persona configuration test double.

use std::sync::{Arc, Mutex};

use bot_id::BotId;
use bots::domain::models::AgentConfig;

use crate::domain::error::Result;
use crate::domain::ports::PersonaConfig;

/// A [`PersonaConfig`] serving one configuration for every bot. Cloning shares
/// it, so a test can change what the next session launches with.
#[derive(Clone)]
pub struct PersonaConfigMock {
    config: Arc<Mutex<Option<AgentConfig>>>,
}

impl PersonaConfigMock {
    /// A persona with default harness and model, no prompt and no repository.
    #[must_use]
    pub fn new() -> Self {
        Self {
            config: Arc::new(Mutex::new(Some(AgentConfig::default()))),
        }
    }

    /// Serve this configuration from now on.
    pub fn serves(&self, config: AgentConfig) {
        *self.lock() = Some(config);
    }

    /// Serve no configuration, as for a bot that is not agent-backed.
    pub fn serves_nothing(&self) {
        *self.lock() = None;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<AgentConfig>> {
        self.config
            .lock()
            .expect("persona config mock lock should not be poisoned")
    }
}

impl Default for PersonaConfigMock {
    fn default() -> Self {
        Self::new()
    }
}

impl PersonaConfig for PersonaConfigMock {
    async fn get(&self, _bot_id: BotId) -> Result<Option<AgentConfig>> {
        Ok(self.lock().clone())
    }
}
