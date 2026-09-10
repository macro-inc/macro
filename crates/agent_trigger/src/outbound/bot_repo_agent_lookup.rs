//! Adapting the bots repository to the trigger domain's bot-facts port.

use agent_session::domain::error::{AgentSessionError, Result};
use bot_id::BotId;
use bots::domain::models::{Agent, Bot};
use bots::domain::ports::BotRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::service::{AgentBotLookup, ChannelParticipationLookup, TeamMembershipLookup};

/// Exposes bot repository facts to the agent trigger domain.
///
/// One adapter, three ports: the repository happens to answer all three fact
/// kinds today, so callers clone this into each collaborator slot.
#[derive(Clone)]
pub struct BotRepoAgentLookup<Repo> {
    repo: Repo,
}

impl<Repo> BotRepoAgentLookup<Repo> {
    /// Create a lookup over `repo`.
    pub const fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

impl<Repo> AgentBotLookup for BotRepoAgentLookup<Repo>
where
    Repo: BotRepo,
{
    async fn get_agent(&self, bot_id: BotId) -> Result<Option<Agent>> {
        if bot_id::system_bot(bot_id).is_some() {
            return Ok(None);
        }
        self.repo
            .get_agent(bot_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))
    }

    async fn get_bot(&self, bot_id: BotId) -> Result<Option<Bot>> {
        self.repo
            .get_bot(bot_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))
    }
}

impl<Repo> TeamMembershipLookup for BotRepoAgentLookup<Repo>
where
    Repo: BotRepo,
{
    async fn user_has_team(&self, caller: MacroUserIdStr<'static>, team_id: Uuid) -> Result<bool> {
        self.repo
            .user_has_team(caller, team_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))
    }
}

impl<Repo> ChannelParticipationLookup for BotRepoAgentLookup<Repo>
where
    Repo: BotRepo,
{
    async fn bot_active_in_channel(&self, channel_id: Uuid, bot_id: BotId) -> Result<bool> {
        self.repo
            .bot_active_in_channel(channel_id, bot_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))
    }
}
