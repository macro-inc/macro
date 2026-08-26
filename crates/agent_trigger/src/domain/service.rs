//! Orchestration for evaluating one posted channel message.

use std::collections::HashSet;

#[cfg(test)]
mod test;

use agent_session::domain::error::Result;
use agent_session::domain::model::{AgentSession, AgentSessionId, ChannelSession};
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::side_effects::bot_mention_ids;

use macro_uuid::Uuid;

use crate::domain::broker_events::{AgentSessionMacroEvent, ChannelEventMetadata, ChannelKind};
use crate::domain::thread_window::{ThreadMessage, render_transcript, thread_window};
use crate::domain::yield_event::{
    AgentSessionEventDecision, NoEventReason, PotentialTriggerEvent, yield_event,
};

/// Messages kept either side of a point where the agent spoke or was spoken to.
/// Wide enough to carry the exchange around it, narrow enough that a long
/// thread does not become mostly unrelated chatter.
const WINDOW_RADIUS: usize = 4;

/// Ceiling on transcript length, keeping the most recent messages. A judgement
/// about the newest message rarely turns on what happened dozens of messages
/// ago, and the fast model reads a bounded prompt.
const TRANSCRIPT_CAP: usize = 40;

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

/// Reads whole threads, so an unmentioned message can be judged against the
/// conversation it landed in.
#[cfg_attr(test, mockall::automock)]
pub trait ThreadHistory: Send + Sync + 'static {
    /// Every message of the thread rooted at `thread_id`, oldest first.
    fn thread_messages(
        &self,
        channel_id: Uuid,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadMessage>>> + Send;
}

/// Judges whether an unmentioned message in a session's thread is addressed
/// to the agent.
#[cfg_attr(test, mockall::automock)]
pub trait ImplicitTriggerJudge: Send + Sync + 'static {
    /// Whether the message reads as directed at the session's agent, read
    /// against `transcript` - the thread around the agent's participation in
    /// it, empty when the thread could not be read.
    fn is_addressed_to_agent(
        &self,
        posted: &ChannelMessagePostedMetadata,
        transcript: &str,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Looks up the session context for a channel message and evaluates its trigger rule.
pub struct AgentTriggerService<Repo, Bots, Replies, Judge, History> {
    sessions: Repo,
    bots: Bots,
    replies: Replies,
    judge: Judge,
    history: History,
}

impl<Repo, Bots, Replies, Judge, History> AgentTriggerService<Repo, Bots, Replies, Judge, History>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Replies: ReplyDetector,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
{
    /// Creates a trigger service backed by session and bot lookups.
    pub const fn new(
        sessions: Repo,
        bots: Bots,
        replies: Replies,
        judge: Judge,
        history: History,
    ) -> Self {
        Self {
            sessions,
            bots,
            replies,
            judge,
            history,
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
    /// Only fires when exactly one agent is live in the thread; picking among
    /// several by recency would route on nothing the author meant.
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
        let mut candidates = Vec::new();
        for session in self.sessions.find_all_for_thread(thread_id).await? {
            if self.bots.has_agent(session.bot_id).await? {
                candidates.push(session);
            }
        }
        let session = match candidates.as_slice() {
            [] => return Ok(None),
            [session] => session.clone(),
            sessions => {
                log_no_event(
                    posted,
                    None,
                    NoEventReason::AmbiguousAgentSessions {
                        candidates: sessions.len(),
                    },
                );
                return Ok(None);
            }
        };

        let kind = if self.is_quote_reply(posted).await {
            // A quote-reply says who it answers on its face, so it needs no
            // thread read at all.
            ChannelKind::QuoteReply
        } else if self
            .is_addressed_to_agent(posted, &self.transcript(posted, thread_id, &session).await)
            .await
        {
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

    /// The thread around the points where the agent took part: its own
    /// messages, and the message being judged, each with [`WINDOW_RADIUS`]
    /// messages of surrounding conversation.
    ///
    /// An unreadable thread yields an empty transcript rather than an error, so
    /// the judge still rules on the message itself instead of the whole path
    /// wedging on a thread read.
    async fn transcript(
        &self,
        posted: &ChannelMessagePostedMetadata,
        thread_id: Uuid,
        session: &AgentSession,
    ) -> String {
        let messages = match self
            .history
            .thread_messages(posted.channel_id, thread_id)
            .await
        {
            Ok(messages) => messages,
            Err(error) => {
                tracing::warn!(error = ?error, "thread read failed; judging without thread context");
                return String::new();
            }
        };
        let agent = session.bot_id.into_storage_id();
        let anchors: Vec<Uuid> = messages
            .iter()
            .filter(|message| {
                message.id == posted.message_id
                    || message
                        .sender
                        .as_bot()
                        .is_some_and(|bot| bot.as_ref() == agent.as_ref())
            })
            .map(|message| message.id)
            .collect();

        render_transcript(
            &thread_window(&messages, &anchors, WINDOW_RADIUS, TRANSCRIPT_CAP),
            session.bot_id,
        )
    }

    async fn is_addressed_to_agent(
        &self,
        posted: &ChannelMessagePostedMetadata,
        transcript: &str,
    ) -> bool {
        self.judge
            .is_addressed_to_agent(posted, transcript)
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
