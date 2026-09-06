//! Postgres-backed [`BotDirectory`] for the agent-session create route.
//!
//! A composition-root adapter: the port in `agent_session` asks for the few
//! facts that gate opening sessions, and this answers them from the bots
//! repo without either domain crate growing a dependency on `bots`.

use agent_harness::domain::model::AgentKind;
use agent_session::domain::error::{AgentSessionError, Result};
use agent_session::domain::ports::{BotDirectory, BotFacts, ManagedAgentProfile};
use bot_id::BotId;
use bots::domain::models::BotOwner;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use macro_user_id::user_id::MacroUserIdStr;

/// [`BotDirectory`] over the bots table.
#[derive(Clone)]
pub struct PgBotDirectory {
    repo: PgBotsRepo,
}

impl PgBotDirectory {
    /// Wrap a bots repo.
    pub fn new(repo: PgBotsRepo) -> Self {
        Self { repo }
    }
}

impl BotDirectory for PgBotDirectory {
    async fn bot_facts(&self, bot: BotId) -> Result<Option<BotFacts>> {
        let Some(row) = self
            .repo
            .get_bot(bot)
            .await
            .map_err(AgentSessionError::Unknown)?
        else {
            return Ok(None);
        };
        let (owner_user_id, owner_team_id) = match row.owner {
            Some(BotOwner::User { user_id }) => {
                let owner = MacroUserIdStr::try_from(user_id).map_err(|error| {
                    AgentSessionError::Unknown(anyhow::anyhow!(
                        "bot has an unparseable owner: {error}"
                    ))
                })?;
                (Some(owner), None)
            }
            Some(BotOwner::Team { team_id }) => (None, Some(team_id)),
            None => (None, None),
        };
        let (is_managed, harness_id, managed_profile) = if row.has_agent {
            let agent = self
                .repo
                .get_agent(bot)
                .await
                .map_err(AgentSessionError::Unknown)?;
            let harness_id = agent.as_ref().and_then(|agent| agent.harness_id);
            let is_managed = agent
                .as_ref()
                .map_or_else(
                    || AgentKind::of(bot),
                    |agent| AgentKind::from_harness(&agent.harness),
                )
                .is_managed();
            let managed_profile = agent
                .filter(|_| is_managed)
                .map(|agent| ManagedAgentProfile {
                    model: agent.default_model,
                    harness: agent.harness,
                    instructions: agent.instructions,
                    mcp_servers: agent.mcp,
                });
            (is_managed, harness_id, managed_profile)
        } else {
            (false, None, None)
        };
        Ok(Some(BotFacts {
            has_agent: row.has_agent,
            is_managed,
            owner_user_id,
            owner_team_id,
            harness_id,
            managed_profile,
        }))
    }

    async fn user_has_team(
        &self,
        user: MacroUserIdStr<'static>,
        team_id: macro_uuid::Uuid,
    ) -> Result<bool> {
        self.repo
            .user_has_team(user, team_id)
            .await
            .map_err(AgentSessionError::Unknown)
    }
}
