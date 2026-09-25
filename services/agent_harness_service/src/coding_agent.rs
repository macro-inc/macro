//! Postgres-backed coding-agent choices for database-backed agents.

use agent_harness::domain::ports::CodingAgentSource;
use bot_id::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;

/// Reads the persona's setting of being a coding agent. Fixed system bots
/// have no persona and so no setting; the domain lets their runtime decide.
#[derive(Clone)]
pub struct PgCodingAgentSource {
    repo: PgBotsRepo,
}

impl PgCodingAgentSource {
    /// Build the source over the bots repository.
    pub fn new(repo: PgBotsRepo) -> Self {
        Self { repo }
    }
}

impl CodingAgentSource for PgCodingAgentSource {
    async fn coding_agent_choice(&self, bot: BotId) -> anyhow::Result<Option<bool>> {
        Ok(self.repo.get_agent(bot).await?.map(|agent| agent.is_coding))
    }
}
