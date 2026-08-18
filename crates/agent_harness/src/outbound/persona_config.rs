//! Reads persona configuration through the `bots` crate.
//!
//! `bot_agent_config` belongs to the bots domain, so this adapter asks that
//! crate's service for it rather than querying the table directly.

use bot_id::BotId;
use bots::domain::models::AgentConfig;
use bots::domain::ports::BotService;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::PersonaConfig;

/// [`PersonaConfig`] backed by the bots service.
#[derive(Debug, Clone)]
pub struct BotsPersonaConfig<Bots> {
    bots: Bots,
}

impl<Bots> BotsPersonaConfig<Bots> {
    /// Read persona configuration through `bots`.
    pub fn new(bots: Bots) -> Self {
        Self { bots }
    }
}

impl<Bots> PersonaConfig for BotsPersonaConfig<Bots>
where
    Bots: BotService,
{
    async fn get(&self, bot_id: BotId) -> Result<Option<AgentConfig>> {
        self.bots
            .agent_config(bot_id)
            .await
            .map_err(|error| HarnessError::PersonaConfig(rootcause::report!(error).into()))
    }
}
