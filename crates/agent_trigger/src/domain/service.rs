//! Orchestration for evaluating one posted channel message.

use std::collections::HashSet;

#[cfg(test)]
mod test;

use agent_session::domain::error::Result;
use agent_session::domain::model::{AgentSession, AgentSessionId, ChannelSession};
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::BotId;
use bots::domain::models::{Agent, AgentChannelScope, Bot, BotKind, BotOwner};
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::side_effects::bot_mention_ids;

use channel_sender::ChannelSender;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
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
    /// Get an active persisted agent by bot id.
    fn get_agent(&self, bot_id: BotId) -> impl Future<Output = Result<Option<Agent>>> + Send;

    /// Get an active bot, including a fixed system bot, by id.
    fn get_bot(&self, bot_id: BotId) -> impl Future<Output = Result<Option<Bot>>> + Send;
}

/// Team-membership facts, for agents shared with their owning team.
///
/// Its own port rather than a bot fact: membership belongs to the teams
/// domain, and the trigger domain only ever asks this one question of it.
#[cfg_attr(test, mockall::automock)]
pub trait TeamMembershipLookup: Send + Sync + 'static {
    /// Check whether a user belongs to a team.
    fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Channel-participation facts, for agents scoped to selected channels.
///
/// Its own port rather than a bot fact: participation belongs to the channels
/// domain, and the trigger domain only ever asks this one question of it.
#[cfg_attr(test, mockall::automock)]
pub trait ChannelParticipationLookup: Send + Sync + 'static {
    /// Check whether a bot is an active channel participant.
    fn bot_active_in_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// The leading reply-target of an explicit reply: who the author answered,
/// and which message they pointed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedExplicitReply {
    /// Channel containing the targeted message.
    pub channel_id: String,
    /// Targeted channel message.
    pub target_message_id: String,
    /// Thread containing the targeted message.
    pub target_thread_id: String,
    /// Static one-line preview rendered by the reply target.
    pub display_text: String,
    /// Sender of the targeted message — who the author replied to.
    pub sender_id: String,
}

/// Extracts the leading reply-target from markdown composed as an explicit
/// reply: a `ReplyTargetNode` followed by the author's response.
#[cfg_attr(test, mockall::automock)]
pub trait ExplicitReplyExtractor: Send + Sync + 'static {
    /// The leading reply-target when this markdown is an explicit reply.
    fn extract_explicit_reply(
        &self,
        markdown: &str,
    ) -> impl Future<Output = Result<Option<ExtractedExplicitReply>>> + Send;
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
pub struct AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History> {
    sessions: Repo,
    bots: Bots,
    teams: Teams,
    channels: Channels,
    replies: Replies,
    judge: Judge,
    history: History,
}

impl<Repo, Bots, Teams, Channels, Replies, Judge, History>
    AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Channels: ChannelParticipationLookup,
    Replies: ExplicitReplyExtractor,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
{
    /// Creates a trigger service backed by session, bot, membership, and
    /// participation lookups.
    pub const fn new(
        sessions: Repo,
        bots: Bots,
        teams: Teams,
        channels: Channels,
        replies: Replies,
        judge: Judge,
        history: History,
    ) -> Self {
        Self {
            sessions,
            bots,
            teams,
            channels,
            replies,
            judge,
            history,
        }
    }

    /// Whether `posted` may address `bot_id` under the bot's current scope.
    ///
    /// System agents are global. Persisted all-channel agents are private to
    /// their owner or shared with their owning team. Selected agents and
    /// legacy agent-backed bots use explicit channel participation.
    async fn agent_is_available(
        &self,
        posted: &ChannelMessagePostedMetadata,
        bot_id: BotId,
    ) -> Result<bool> {
        let Some(caller) = posted.sender.as_user().cloned().map(CowLike::into_owned) else {
            return Ok(false);
        };

        if let Some(agent) = self.bots.get_agent(bot_id).await? {
            if !agent.bot.has_agent {
                return Ok(false);
            }
            return match agent.channel_scope {
                AgentChannelScope::All => match agent.bot.owner {
                    Some(BotOwner::User { user_id }) => Ok(user_id == caller.as_ref()),
                    Some(BotOwner::Team { team_id }) => {
                        self.teams.user_has_team(caller, team_id).await
                    }
                    None => Ok(false),
                },
                AgentChannelScope::Selected => {
                    self.channels
                        .bot_active_in_channel(posted.channel_id, bot_id)
                        .await
                }
            };
        }

        let Some(bot) = self.bots.get_bot(bot_id).await? else {
            return Ok(false);
        };
        if !bot.has_agent {
            return Ok(false);
        }
        match bot.kind {
            BotKind::System => Ok(true),
            BotKind::Owned => {
                self.channels
                    .bot_active_in_channel(posted.channel_id, bot_id)
                    .await
            }
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
        let available = match bot {
            Some(bot_id) => self.agent_is_available(posted, bot_id).await?,
            None => false,
        };

        let message = PotentialTriggerEvent::Channel {
            posted,
            existing: &existing,
            mentioned_bot,
        };
        match yield_event(&message, available) {
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
    /// thread: an explicit reply that targets a live session's bot, or that
    /// session's originating message, is forwarded outright. Anything else
    /// only when the judge reads it as addressed to the agent.
    ///
    /// An extracted reply names who and which message it answers, so it can
    /// pick among several live agents. The inferred path still only fires when
    /// exactly one agent is live; picking among several by recency would route
    /// on nothing the author meant.
    ///
    /// Extractor and judge failures are treated as "no" rather than propagated:
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
            if self.agent_is_available(posted, session.bot_id).await? {
                candidates.push(session);
            }
        }

        if !candidates.is_empty()
            && let Some(session) = self.explicit_reply_session(posted, &candidates).await
        {
            // The reply-target says who it answers on its face, so it needs no
            // thread read at all.
            return Ok(Some(channel_event(
                session,
                ChannelKind::ExplicitReply,
                posted,
            )));
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

        if self
            .is_addressed_to_agent(posted, &self.transcript(posted, thread_id, &session).await)
            .await
        {
            return Ok(Some(channel_event(session, ChannelKind::Inferred, posted)));
        }

        log_no_event(
            posted,
            None,
            NoEventReason::NotAddressedToAgent {
                session_id: session.id,
            },
        );
        Ok(None)
    }

    /// The live session the extracted reply-target names: either its bot, or
    /// uniquely its originating message.
    async fn explicit_reply_session(
        &self,
        posted: &ChannelMessagePostedMetadata,
        candidates: &[AgentSession],
    ) -> Option<AgentSession> {
        let reply = self
            .replies
            .extract_explicit_reply(&posted.content)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error = ?error,
                    "explicit reply extraction failed; treating as not a reply"
                );
            })
            .ok()
            .flatten()?;
        session_targeted_by_reply(candidates, &reply).cloned()
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

fn channel_event(
    session: AgentSession,
    kind: ChannelKind,
    posted: &ChannelMessagePostedMetadata,
) -> AgentSessionMacroEvent {
    AgentSessionMacroEvent::channel_event(ChannelEventMetadata {
        bot_id: session.bot_id,
        session_id: session.id,
        kind,
        message: posted.clone(),
    })
}

/// The live session the reply-target names: its bot as addressee, or uniquely
/// the message that opened the session.
fn session_targeted_by_reply<'a>(
    candidates: &'a [AgentSession],
    reply: &ExtractedExplicitReply,
) -> Option<&'a AgentSession> {
    if let Some(session) = session_named_by_bot(candidates, reply) {
        return Some(session);
    }
    session_named_by_originating_message(candidates, reply)
}

fn session_named_by_bot<'a>(
    candidates: &'a [AgentSession],
    reply: &ExtractedExplicitReply,
) -> Option<&'a AgentSession> {
    let sender = ChannelSender::parse_from_str(&reply.sender_id).ok()?;
    let bot_id = sender.as_bot()?.bot_id();
    candidates.iter().find(|session| session.bot_id == bot_id)
}

fn session_named_by_originating_message<'a>(
    candidates: &'a [AgentSession],
    reply: &ExtractedExplicitReply,
) -> Option<&'a AgentSession> {
    let target = Uuid::parse_str(&reply.target_message_id).ok()?;
    let mut matches = candidates
        .iter()
        .filter(|session| session.originating_message_id == Some(target));
    let session = matches.next()?;
    matches.next().is_none().then_some(session)
}
