//! Domain types the harness owns.
//!
//! Only what nothing else models. A channel message that mentioned bots is
//! already `channels::domain::side_effects::ChannelBotTrigger` - carrying a
//! `MutatedMessage` with the ids, thread, sender, and content, plus the matched
//! `bot_ids` - so the harness takes that rather than projecting it into a
//! parallel struct. `SimpleMention` and `ChannelSender` likewise already exist.
//!
//! What is genuinely ours is the agent session: a run scoped to one bot in one
//! channel thread. agent_proxy holds the chat, the ACP session id, and the
//! message history; it has no notion of a channel thread, a bot, a repository,
//! or which harness image ran.

use bot_id::BotId;
use channels::domain::side_effects::ChannelBotTrigger;
use macro_uuid::Uuid;

/// The thread a reply to `trigger`'s message belongs in.
///
/// A channel thread *is* its parent message, so one expression covers both
/// cases: a top-level message opens a new thread by hanging off itself, and a
/// message already in a thread joins it.
///
/// Also the value that identifies the conversation for the session lookup,
/// which is why it is not merely `thread_id` - two separate top-level mentions
/// in one channel are different conversations, and a bare `None` could not tell
/// them apart.
#[must_use]
pub fn reply_thread_id(trigger: &ChannelBotTrigger) -> Uuid {
    trigger.message.thread_id.unwrap_or(trigger.message.id)
}

/// Lifecycle of an agent session, mirroring the `agent_session_status` enum.
///
/// The last state observed, not a state machine: nothing here forbids a
/// transition, and a harness that dies mid-run leaves a row reading `Booting`
/// or `Ready` forever until something reconciles it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentSessionStatus {
    /// The sandbox is coming up; the agent cannot be prompted yet.
    Booting,
    /// The ACP session is established and the agent can work.
    Ready,
    /// The session ended without error; its sandbox is gone.
    Offline,
    /// The session ended because something broke.
    Failed,
}

/// One agent session, mirroring a row of `agent_sessions`.
///
/// Scoped to **one bot in one thread**: `@claude` and `@codex` in the same
/// thread get one session each, running in parallel.
#[derive(Debug, Clone)]
pub struct AgentSession {
    /// The session's own id.
    pub id: Uuid,
    /// Thread the mention that created this session was posted in. `None` when
    /// the session has no parent.
    pub created_from_thread_id: Option<Uuid>,
    /// The session's own thread - the orphaned thread that behaves like a
    /// thread and holds the run's messages, tool calls, and results. This is
    /// what the reply links to.
    pub thread_id: Uuid,
    /// Bot this session answers for.
    pub bot_id: BotId,
    /// Model the agent runs.
    pub model: String,
    /// Which harness runs the agent.
    pub harness: String,
    /// Repository cloned into the sandbox.
    pub repo_url: String,
    /// The last lifecycle state observed for the session.
    pub last_status: AgentSessionStatus,
}

/// What the session lookup found for an incoming message.
///
/// The three cases are the question the join answers: is there a session, do I
/// own it, and was it created *at* this thread or is this message arriving in
/// the session's own orphaned thread?
#[derive(Debug, Clone)]
pub enum ThreadSession {
    /// No session for this bot in this thread. A mention starts one.
    None,
    /// This bot's session, created from the thread the message is in. A mention
    /// continues it and re-posts a link.
    CreatedFromThisThread(AgentSession),
    /// The message arrived inside the session's own orphaned thread, rather
    /// than the thread the session was created from.
    InSessionThread(AgentSession),
}
