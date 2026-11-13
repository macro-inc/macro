//! Postgres-backed persona settings and memory for database-backed agents.

use agent_harness::domain::ports::PersonaSource;
use bot_id::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;

/// Reads the persona's setting of being a coding agent and its memory. Fixed
/// system bots have no persona and so neither; the domain lets their runtime
/// decide.
#[derive(Clone)]
pub struct PgPersonaSource {
    repo: PgBotsRepo,
}

impl PgPersonaSource {
    /// Build the source over the bots repository.
    pub fn new(repo: PgBotsRepo) -> Self {
        Self { repo }
    }
}

impl PersonaSource for PgPersonaSource {
    async fn coding_agent_choice(&self, bot: BotId) -> anyhow::Result<Option<bool>> {
        Ok(self.repo.get_agent(bot).await?.map(|agent| agent.is_coding))
    }

    async fn memory(&self, bot: BotId) -> anyhow::Result<Option<String>> {
        Ok(self
            .repo
            .get_agent_memory(bot)
            .await?
            .map(|memory| memory.content)
            .filter(|content| !content.trim().is_empty()))
    }
}
