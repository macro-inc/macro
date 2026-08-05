//! Orchestration for evaluating one posted channel message.

use std::collections::HashSet;

#[cfg(test)]
mod test;

use agent_session::domain::error::Result;
use agent_session::domain::model::{AgentSessionId, ChannelSession};
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::side_effects::bot_mention_ids;

use crate::domain::broker_events::AgentSessionMacroEvent;
use crate::domain::yield_event::{AgentSessionEventDecision, NoEventReason, yield_event};

/// Bot facts required to decide whether a mention may start an agent session.
#[cfg_attr(test, mockall::automock)]
pub trait AgentBotLookup: Send + Sync + 'static {
    /// Whether this bot is configured with an agent.
    fn has_agent(&self, bot_id: BotId) -> impl Future<Output = Result<bool>> + Send;
}

/// Looks up the session context for a channel message and evaluates its trigger rule.
pub struct AgentTriggerService<Repo, Bots> {
    sessions: Repo,
    bots: Bots,
}

impl<Repo, Bots> AgentTriggerService<Repo, Bots>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
{
    /// Creates a trigger service backed by session and bot lookups.
    pub const fn new(sessions: Repo, bots: Bots) -> Self {
        Self { sessions, bots }
    }

    /// Evaluates one channel message for every mentioned bot.
    #[tracing::instrument(err, skip(self, posted), fields(
        channel_id = %posted.channel_id,
        message_id = %posted.message_id,
        thread_id = ?posted.thread_id,
    ))]
    pub async fn evaluate(
        &self,
        posted: &ChannelMessagePostedMetadata,
    ) -> Result<Vec<AgentSessionMacroEvent>> {
        let mut mentioned = bot_mention_ids(&posted.mentions);
        mentioned.sort_by_key(ToString::to_string);
        let mut seen_sessions = HashSet::new();
        let mut events = Vec::new();

        if mentioned.is_empty() {
            if let Some(event) = self.evaluate_bot(posted, None, &mut seen_sessions).await? {
                events.push(event);
            }
            return Ok(events);
        }

        for bot_id in mentioned {
            if let Some(event) = self
                .evaluate_bot(posted, Some(bot_id), &mut seen_sessions)
                .await?
            {
                events.push(event);
            }
        }

        Ok(events)
    }

    async fn evaluate_bot(
        &self,
        posted: &ChannelMessagePostedMetadata,
        mentioned_bot: Option<BotId>,
        seen_sessions: &mut HashSet<AgentSessionId>,
    ) -> Result<Option<AgentSessionMacroEvent>> {
        let existing = self
            .sessions
            .find_for_channel(posted.channel_id, posted.thread_id, mentioned_bot)
            .await?;
        if let Some(session_id) = session_id(&existing)
            && !seen_sessions.insert(session_id)
        {
            log_no_event(
                posted,
                mentioned_bot,
                NoEventReason::DuplicateSession { session_id },
            );
            return Ok(None);
        }
        let bot = match &existing {
            ChannelSession::InDedicatedChannel(session)
            | ChannelSession::CreatedFromThread(session) => Some(session.bot_id),
            ChannelSession::None => mentioned_bot,
            ChannelSession::ThreadInDedicatedChannel { .. } => None,
        };
        let has_agent = match bot {
            Some(bot_id) => self.bots.has_agent(bot_id).await?,
            None => false,
        };

        match yield_event(posted, &existing, mentioned_bot, has_agent) {
            AgentSessionEventDecision::Event(event) => Ok(Some(event)),
            AgentSessionEventDecision::NoEvent(reason) => {
                log_no_event(posted, mentioned_bot, reason);
                Ok(None)
            }
        }
    }
}

fn log_no_event(
    posted: &ChannelMessagePostedMetadata,
    mentioned_bot: Option<BotId>,
    reason: NoEventReason,
) {
    tracing::debug!(
        message_id = %posted.message_id,
        ?mentioned_bot,
        ?reason,
        "agent trigger emitted no event"
    );
}

fn session_id(session: &ChannelSession) -> Option<AgentSessionId> {
    match session {
        ChannelSession::InDedicatedChannel(session)
        | ChannelSession::CreatedFromThread(session) => Some(session.id),
        ChannelSession::None | ChannelSession::ThreadInDedicatedChannel { .. } => None,
    }
}
