//! Persona eligibility through the owning bot service.

use bot_id::BotId;
use bots::domain::ports::BotRepo;
use bots::domain::ports::{AgentDmEligibility, BotError};
use channels::domain::agent_dm::{AgentDmProfile, AgentDmProfiles, AgentDmRepo};
use channels::domain::{agent_dm::AgentDmAuthorizer, ports::ChannelMutationErr};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use uuid::Uuid;

/// Reads historical persona presentation through its owning domain port.
pub struct AgentDmProfileReader<C, B> {
    channels: C,
    bots: B,
}

impl<C, B> AgentDmProfileReader<C, B> {
    /// Compose channel binding and bot profile readers at the service root.
    pub fn new(channels: C, bots: B) -> Self {
        Self { channels, bots }
    }
}

#[async_trait::async_trait]
impl<C: AgentDmRepo, B: BotRepo> AgentDmProfiles for AgentDmProfileReader<C, B> {
    async fn for_channels(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, AgentDmProfile>, rootcause::Report> {
        if channel_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let bindings: Vec<_> = self
            .channels
            .for_user(user_id)
            .await
            .map_err(|error| rootcause::report!(error))?
            .into_iter()
            .filter(|dm| channel_ids.contains(&dm.channel_id))
            .collect();
        let bot_ids: Vec<_> = bindings.iter().map(|dm| dm.bot_id).collect();
        let profiles = self
            .bots
            .get_bot_profiles(&bot_ids)
            .await
            .map_err(|error| rootcause::report!(error.into()))?;
        Ok(bindings
            .into_iter()
            .map(|dm| {
                let profile = profiles.get(&dm.bot_id);
                (
                    dm.channel_id,
                    AgentDmProfile {
                        bot_id: dm.bot_id,
                        name: profile
                            .map(|p| p.name.clone())
                            .unwrap_or_else(|| "Unavailable agent".to_owned()),
                        avatar_url: profile.and_then(|p| p.avatar_url.clone()),
                    },
                )
            })
            .collect())
    }
}

/// Adapts the bot service's authorized persona catalog to channel DM creation.
pub struct BotServiceDmAuthorizer<B>(pub B);

impl<B: AgentDmEligibility> AgentDmAuthorizer for BotServiceDmAuthorizer<B> {
    async fn authorize(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<(), ChannelMutationErr> {
        self.0
            .authorize_agent_dm(user_id, bot_id)
            .await
            .map_err(|error| match error {
                BotError::Unauthorized | BotError::NotFound(_) => {
                    ChannelMutationErr::Forbidden("This agent is unavailable to you".to_owned())
                }
                BotError::BadRequest(message) => ChannelMutationErr::BadRequest(message),
                BotError::Unavailable(message) => {
                    ChannelMutationErr::Repo(anyhow::anyhow!(message))
                }
                BotError::Repo(error) => ChannelMutationErr::Repo(error),
            })
    }
}
