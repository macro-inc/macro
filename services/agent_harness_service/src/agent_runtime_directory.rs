//! Postgres-backed runtime profiles for fixed and database-backed agents.

use agent_harness::domain::error::{HarnessError, Result};
use agent_harness::domain::model::{AgentKind, AgentRuntimeConfig};
use agent_harness::domain::ports::AgentRuntimeDirectory;
use bot_id::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;

/// Resolves fixed system profiles first, then user/team agent configuration.
#[derive(Clone)]
pub struct PgAgentRuntimeDirectory {
    repo: PgBotsRepo,
    fixed: Vec<(BotId, AgentRuntimeConfig)>,
}

impl PgAgentRuntimeDirectory {
    /// Build the directory over the bots repository and deployment-owned
    /// system profiles.
    pub fn new(repo: PgBotsRepo, fixed: Vec<(BotId, AgentRuntimeConfig)>) -> Self {
        Self { repo, fixed }
    }
}

impl AgentRuntimeDirectory for PgAgentRuntimeDirectory {
    async fn runtime_for(&self, bot_id: BotId) -> Result<Option<AgentRuntimeConfig>> {
        if let Some((_, runtime)) = self.fixed.iter().find(|(fixed, _)| *fixed == bot_id) {
            return Ok(Some(runtime.clone()));
        }

        let agent =
            self.repo.get_agent(bot_id).await.map_err(|error| {
                HarnessError::RuntimeDirectory(rootcause::report!(error).into())
            })?;
        Ok(agent
            .filter(|agent| agent.bot.has_agent)
            .map(|agent| AgentRuntimeConfig {
                kind: AgentKind::from_harness(&agent.harness),
                model: agent.default_model,
                harness: agent.harness,
                instructions: agent.instructions,
                mcp_servers: agent.mcp,
            }))
    }
}
