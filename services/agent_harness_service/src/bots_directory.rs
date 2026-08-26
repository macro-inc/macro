//! Postgres-backed [`BotDirectory`] for the agent-session create route.
//!
//! A composition-root adapter: the port in `agent_session` asks for the few
//! facts that gate opening sessions, and this answers them from the bots
//! repo without either domain crate growing a dependency on `bots`.

use agent_harness::domain::model::AgentKind;
use agent_harness::domain::ports::PersonaDirectory;
use agent_session::domain::error::{AgentSessionError, Result};
use agent_session::domain::ports::{BotDirectory, BotFacts};
use bot_id::BotId;
use bots::domain::models::BotOwner;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use macro_user_id::user_id::MacroUserIdStr;

use crate::personas_directory::PgPersonaDirectory;

/// [`BotDirectory`] over the bots table (which resolves personas too).
#[derive(Clone)]
pub struct PgBotDirectory {
    repo: PgBotsRepo,
    personas: PgPersonaDirectory,
}

impl PgBotDirectory {
    /// Wrap a bots repo and the persona directory.
    pub fn new(repo: PgBotsRepo, personas: PgPersonaDirectory) -> Self {
        Self { repo, personas }
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
        let owner_user_id = match row.owner {
            Some(BotOwner::User { user_id }) => {
                Some(MacroUserIdStr::try_from(user_id).map_err(|error| {
                    AgentSessionError::Unknown(anyhow::anyhow!(
                        "bot has an unparseable owner: {error}"
                    ))
                })?)
            }
            Some(BotOwner::Team { .. }) | None => None,
        };
        // A persona's sessions run on the in-memory harness this deployment
        // provisions, so it is managed even though `AgentKind::of` cannot
        // know it (personas are rows, not registry constants).
        let is_managed = AgentKind::of(bot).is_managed()
            || self
                .personas
                .persona(bot)
                .await
                .map_err(AgentSessionError::Unknown)?
                .is_some();
        Ok(Some(BotFacts {
            has_agent: row.has_agent,
            is_managed,
            owner_user_id,
        }))
    }
}
