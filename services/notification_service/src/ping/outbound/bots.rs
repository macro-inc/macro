//! [`AgentProfiles`] over the bots repository.

use bot_id::BotId;
use bots::domain::ports::BotRepo;
use model_notifications::PingAgent;
use rootcause::compat::IntoRootcause;

use crate::ping::AgentProfiles;

/// Reads agent names and avatars from the bots table, system bots included.
pub(crate) struct BotAgentProfiles<Bots>(pub Bots);

impl<Bots: BotRepo> AgentProfiles for BotAgentProfiles<Bots> {
    async fn profile(&self, agent_id: BotId) -> Result<Option<PingAgent>, rootcause::Report> {
        let mut profiles = self
            .0
            .get_bot_profiles(&[agent_id])
            .await
            .map_err(|error| Into::<anyhow::Error>::into(error).into_rootcause())?;

        Ok(profiles.remove(&agent_id).map(|profile| PingAgent {
            id: profile.id.as_uuid(),
            name: profile.name,
            avatar_url: profile.avatar_url,
        }))
    }
}
