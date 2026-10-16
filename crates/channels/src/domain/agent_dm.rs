//! Private, durable conversations between one user and one agent persona:
//! the direct kind of [`ChannelAgent`](super::channel_agents::ChannelAgent).

use std::sync::Arc;

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use uuid::Uuid;

use super::{
    events::ChannelEvent,
    models::{ChannelType, GetOrCreateAction, GetOrCreateChannelResponse, Sender},
    ports::{ChannelEventDispatcher, ChannelMutationErr},
};

#[cfg(test)]
mod test;

/// The identity of a persona DM. The user alone owns the conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentDm {
    /// Channel containing the conversation.
    pub channel_id: Uuid,
    /// User whose history, credentials, and permissions the conversation uses.
    pub user_id: MacroUserIdStr<'static>,
    /// Persona addressed by every user message in the channel.
    pub bot_id: BotId,
}

/// Result of atomically ensuring the user's conversation with a persona.
pub struct EnsuredAgentDm {
    /// Durable conversation identity.
    pub dm: AgentDm,
    /// Whether this request created the channel.
    pub created: bool,
}

/// Historical persona identity displayed beside a private conversation.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AgentDmProfile {
    /// Persona id without the bot principal prefix.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub bot_id: BotId,
    /// Persona display name.
    pub name: String,
    /// Persona avatar, when supplied.
    pub avatar_url: Option<String>,
}

/// Batch presentation facts supplied by the channel and persona owners.
#[async_trait::async_trait]
pub trait AgentDmProfiles: Send + Sync + 'static {
    /// Resolve profiles only for the caller's DMs among these channels.
    async fn for_channels(
        &self,
        user_id: MacroUserIdStr<'static>,
        channel_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, AgentDmProfile>, rootcause::Report>;
}

/// Channel-owned persistence for agent DM identities and membership.
pub trait AgentDmRepo: Send + Sync + 'static {
    /// List the caller's durable bindings, including retained history.
    fn for_user(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<AgentDm>, ChannelMutationErr>> + Send;
    /// Create the channel and both memberships atomically, or restore the
    /// existing pair. Concurrent requests must return the same channel.
    fn ensure(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<EnsuredAgentDm, ChannelMutationErr>> + Send;
}

/// Persona-domain authorization, independent of channel-placement settings.
pub trait AgentDmAuthorizer: Send + Sync + 'static {
    /// Require a runnable persona owned by the user or available to their team.
    /// Existing channel membership alone does not grant permission to start a DM.
    fn authorize(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send;
}

/// Agent DM commands exposed to the channel application service.
#[async_trait::async_trait]
pub trait AgentDirectMessages: Send + Sync + 'static {
    /// Open the caller's private conversation with an eligible persona.
    async fn get_or_create(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr>;
}

/// Coordinates persona eligibility, atomic channel creation, and channel events.
pub struct AgentDmService<R, A, E> {
    repo: R,
    authorizer: A,
    events: E,
}

impl<R, A, E> AgentDmService<R, A, E> {
    /// Compose channel persistence, persona authorization, and channel events.
    pub fn new(repo: R, authorizer: A, events: E) -> Self {
        Self {
            repo,
            authorizer,
            events,
        }
    }
}

#[async_trait::async_trait]
impl<R: AgentDmRepo, A: AgentDmAuthorizer, E: ChannelEventDispatcher> AgentDirectMessages
    for AgentDmService<R, A, E>
{
    async fn get_or_create(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<GetOrCreateChannelResponse, ChannelMutationErr> {
        // Rechecked even for an existing DM: a former teammate may retain
        // their history without retaining permission to run the persona.
        self.authorizer.authorize(user_id.clone(), bot_id).await?;
        let result = self.repo.ensure(user_id.clone(), bot_id).await?;
        if result.created {
            self.events.dispatch(ChannelEvent::ChannelCreated {
                channel_id: result.dm.channel_id,
                actor: Sender::new_from_user(user_id.clone()),
                on_behalf_of: None,
                channel_type: ChannelType::DirectMessage,
                channel_name: None,
                // Bots are participants, but never human notification recipients.
                participant_user_ids: vec![user_id],
            });
        }
        Ok(GetOrCreateChannelResponse {
            channel_id: result.dm.channel_id.to_string(),
            action: if result.created {
                GetOrCreateAction::Create
            } else {
                GetOrCreateAction::Get
            },
        })
    }
}

impl<R: AgentDmRepo> AgentDmRepo for Arc<R> {
    async fn for_user(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<AgentDm>, ChannelMutationErr> {
        (**self).for_user(user_id).await
    }
    async fn ensure(
        &self,
        user_id: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<EnsuredAgentDm, ChannelMutationErr> {
        (**self).ensure(user_id, bot_id).await
    }
}
