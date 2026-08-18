//! Postgres-backed [`BotDirectory`] for the agent-session create route.
//!
//! A composition-root adapter: the port in `agent_session` asks for the few
//! facts that gate opening sessions, and this answers them from the bots
//! repo without either domain crate growing a dependency on `bots`.

use agent_session::domain::error::{AgentSessionError, Result};
use agent_session::domain::ports::{BotDirectory, BotFacts};
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
        let (owner_user_id, team_id) = match row.owner {
            Some(BotOwner::User { user_id }) => {
                let user = MacroUserIdStr::try_from(user_id).map_err(|error| {
                    AgentSessionError::Unknown(anyhow::anyhow!(
                        "bot has an unparseable owner: {error}"
                    ))
                })?;
                (Some(user), None)
            }
            Some(BotOwner::Team { team_id }) => (None, Some(team_id)),
            None => (None, None),
        };
        // Managed means this deployment provisions the sandbox, which is
        // exactly the bots we hold a persona config for. It used to be a
        // hardcoded id, back when the managed set was a closed set of one;
        // personas are what ended that.
        let is_managed = self
            .repo
            .agent_config(bot)
            .await
            .map_err(AgentSessionError::Unknown)?
            .is_some();

        Ok(Some(BotFacts {
            has_agent: row.has_agent,
            is_managed,
            owner_user_id,
            team_id,
        }))
    }

    async fn user_in_team(
        &self,
        user: &MacroUserIdStr<'static>,
        team: macro_uuid::Uuid,
    ) -> Result<bool> {
        self.repo
            .user_has_team(user.clone(), team)
            .await
            .map_err(AgentSessionError::Unknown)
    }
}
