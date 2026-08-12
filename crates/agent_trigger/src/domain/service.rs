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

use crate::domain::broker_events::{AgentSessionMacroEvent, ChannelEventMetadata, ChannelKind};
use crate::domain::yield_event::{
    AgentSessionEventDecision, NoEventReason, PotentialTriggerEvent, yield_event,
};

/// Bot facts required to decide whether a mention may start an agent session.
#[cfg_attr(test, mockall::automock)]
pub trait AgentBotLookup: Send + Sync + 'static {
    /// Whether this bot is configured with an agent.
    fn has_agent(&self, bot_id: BotId) -> impl Future<Output = Result<bool>> + Send;
}

/// Detects whether a message is composed as a quote-reply - a leading
/// blockquote followed by the reply itself, the shape the editor produces
/// when replying to a message.
#[cfg_attr(test, mockall::automock)]
pub trait ReplyDetector: Send + Sync + 'static {
    /// Whether this markdown is a quote-reply.
    fn is_quote_reply(&self, markdown: &str) -> impl Future<Output = Result<bool>> + Send;
}

/// Judges whether an unmentioned message in a session's thread is addressed
/// to the agent.
#[cfg_attr(test, mockall::automock)]
pub trait ImplicitTriggerJudge: Send + Sync + 'static {
    /// Whether the message reads as directed at the session's agent.
    fn is_addressed_to_agent(
        &self,
        posted: &ChannelMessagePostedMetadata,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Looks up the session context for a channel message and evaluates its trigger rule.
pub struct AgentTriggerService<Repo, Bots, Replies, Judge> {
    sessions: Repo,
    bots: Bots,
    replies: Replies,
    judge: Judge,
}

impl<Repo, Bots, Replies, Judge> AgentTriggerService<Repo, Bots, Replies, Judge>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Replies: ReplyDetector,
    Judge: ImplicitTriggerJudge,
{
    /// Creates a trigger service backed by session and bot lookups.
    pub const fn new(sessions: Repo, bots: Bots, replies: Replies, judge: Judge) -> Self {
        Self {
            sessions,
            bots,
            replies,
            judge,
        }
    }

    /// Evaluates one channel message for every mentioned bot.
    #[tracing::instrument(err, skip(self, posted), fields(
        channel_id = %posted.channel_id,
        message_id = %posted.message_id,
        thread_id = ?posted.thread_id,
        channel.message.scope = tracing::field::Empty,
        agent.mention.bot_count = tracing::field::Empty,
    ))]
    pub async fn evaluate(
        &self,
        posted: &ChannelMessagePostedMetadata,
    ) -> Result<Vec<AgentSessionMacroEvent>> {
        let mut mentioned = bot_mention_ids(&posted.mentions);
        mentioned.sort_by_key(ToString::to_string);
        tracing::Span::current().record(
            "channel.message.scope",
            if posted.thread_id.is_some() {
                "thread"
            } else {
                "channel_top_level"
            },
        );
        tracing::Span::current().record("agent.mention.bot_count", mentioned.len());
        let mut seen_sessions = HashSet::new();
        let mut events = Vec::new();

        if mentioned.is_empty() {
            if let Some(event) = self.evaluate_bot(posted, None, &mut seen_sessions).await? {
                events.push(event);
            } else if let Some(event) = self.evaluate_implicit(posted).await? {
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

    #[tracing::instrument(
        err,
        skip(self, posted, seen_sessions),
        fields(
            channel_id = %posted.channel_id,
            message_id = %posted.message_id,
            bot_id = ?mentioned_bot,
            agent.trigger.outcome = tracing::field::Empty,
        )
    )]
    async fn evaluate_bot(
        &self,
        posted: &ChannelMessagePostedMetadata,
        mentioned_bot: Option<BotId>,
        seen_sessions: &mut HashSet<AgentSessionId>,
    ) -> Result<Option<AgentSessionMacroEvent>> {
        let existing = self
            .sessions
            .find_for_channel(posted.thread_id, mentioned_bot)
            .await?;
        if let Some(session_id) = session_id(&existing)
            && !seen_sessions.insert(session_id)
        {
            let reason = NoEventReason::DuplicateSession { session_id };
            tracing::Span::current().record("agent.trigger.outcome", reason.as_ref());
            log_no_event(posted, mentioned_bot, reason);
            return Ok(None);
        }
        let bot = match &existing {
            ChannelSession::CreatedFromThread(session) => Some(session.bot_id),
            ChannelSession::None => mentioned_bot,
        };
        let has_agent = match bot {
            Some(bot_id) => self.bots.has_agent(bot_id).await?,
            None => false,
        };

        let message = PotentialTriggerEvent::Channel {
            posted,
            existing: &existing,
            mentioned_bot,
        };
        match yield_event(&message, has_agent) {
            AgentSessionEventDecision::Event(event) => {
                let outcome = match existing {
                    ChannelSession::None => "top_level_mentioned",
                    ChannelSession::CreatedFromThread(_) => "mention_thread",
                };
                tracing::Span::current().record("agent.trigger.outcome", outcome);
                Ok(Some(event))
            }
            AgentSessionEventDecision::NoEvent(reason) => {
                tracing::Span::current().record("agent.trigger.outcome", reason.as_ref());
                log_no_event(posted, mentioned_bot, reason);
                Ok(None)
            }
        }
    }

    /// Evaluates an unmentioned message against the sessions rooted at its
    /// thread: a quote-reply is forwarded outright, anything else only when
    /// the judge reads it as addressed to the agent.
    ///
    /// Detector and judge failures are treated as "no" rather than propagated:
    /// implicit triggering is best-effort, and an outage must not wedge the
    /// channel firehose or fabricate forwards.
    async fn evaluate_implicit(
        &self,
        posted: &ChannelMessagePostedMetadata,
    ) -> Result<Option<AgentSessionMacroEvent>> {
        let Some(thread_id) = posted.thread_id else {
            return Ok(None);
        };
        // Only a user implicitly addresses an agent; bot traffic must always
        // mention explicitly, or bots would relay each other forever.
        if posted.sender.as_user().is_none() {
            return Ok(None);
        }
        let sessions = self.sessions.find_all_for_thread(thread_id).await?;
        let mut candidate = None;
        for session in sessions {
            if self.bots.has_agent(session.bot_id).await? {
                candidate = Some(session);
                break;
            }
        }
        let Some(session) = candidate else {
            return Ok(None);
        };

        let kind = if self.is_quote_reply(posted).await {
            ChannelKind::QuoteReply
        } else if self.is_addressed_to_agent(posted).await {
            ChannelKind::Inferred
        } else {
            log_no_event(
                posted,
                None,
                NoEventReason::NotAddressedToAgent {
                    session_id: session.id,
                },
            );
            return Ok(None);
        };

        Ok(Some(AgentSessionMacroEvent::channel_event(
            ChannelEventMetadata {
                bot_id: session.bot_id,
                session_id: session.id,
                kind,
                message: posted.clone(),
            },
        )))
    }

    async fn is_quote_reply(&self, posted: &ChannelMessagePostedMetadata) -> bool {
        self.replies
            .is_quote_reply(&posted.content)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "quote-reply detection failed; treating as not a reply");
            })
            .unwrap_or(false)
    }

    async fn is_addressed_to_agent(&self, posted: &ChannelMessagePostedMetadata) -> bool {
        self.judge
            .is_addressed_to_agent(posted)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "implicit trigger judge failed; treating as not addressed");
            })
            .unwrap_or(false)
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
        ChannelSession::CreatedFromThread(session) => Some(session.id),
        ChannelSession::None => None,
    }
}
