//! Agent personas that converse in a channel, whatever kind of channel it is.

use std::sync::Arc;

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::ports::ChannelMutationErr;

/// An agent persona that converses in a channel: messages in the channel are
/// turns for it, with no mention needed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelAgent {
    /// Channel the conversation happens in.
    pub channel_id: Uuid,
    /// Persona that answers.
    pub bot_id: BotId,
    /// Who the persona converses with there.
    pub kind: ChannelAgentKind,
}

/// Who an agent converses with in its channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChannelAgentKind {
    /// A private channel between one user and the persona. Only that user
    /// prompts it, and it acts with their access.
    Direct {
        /// The user who owns the conversation.
        user_id: MacroUserIdStr<'static>,
    },
    /// A member of a shared channel. Nothing adds these yet, and nothing
    /// routes messages to them until a flow does.
    Member,
}

/// Channel-owned facts about the agents conversing in a channel. A lookup is
/// not authorization.
pub trait ChannelAgentRepo: Send + Sync + 'static {
    /// Every agent conversing in a channel.
    fn agents_in(
        &self,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelAgent>, ChannelMutationErr>> + Send;

    /// One persona's place in a channel, if it converses there.
    fn find(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Option<ChannelAgent>, ChannelMutationErr>> + Send;
}

impl<R: ChannelAgentRepo> ChannelAgentRepo for Arc<R> {
    async fn agents_in(&self, channel_id: Uuid) -> Result<Vec<ChannelAgent>, ChannelMutationErr> {
        (**self).agents_in(channel_id).await
    }

    async fn find(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<Option<ChannelAgent>, ChannelMutationErr> {
        (**self).find(channel_id, bot_id).await
    }
}
