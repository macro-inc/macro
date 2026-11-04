//! External agent models.

use bot_id::BotId;
use bots::domain::models::Bot;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use serde::Serialize;
use uuid::Uuid;

/// Model stored on every external agent. Its runtime chooses its own model,
/// and an agent configuration requires one.
pub const EXTERNAL_AGENT_MODEL: &str = "external";

/// Event type of an external agent's message event, on the webhook and in
/// the `X-Macro-Event` header.
pub const MESSAGE_EVENT_TYPE: &str = "external_agent.message";

/// Schema version of [`MessageEventEnvelope`].
pub const MESSAGE_EVENT_SCHEMA_VERSION: u8 = 1;

/// Where an external agent's events are pushed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentEndpoint {
    /// The webhook subscription delivering the agent's events.
    pub webhook_id: String,
    /// URL the events are posted to.
    pub url: String,
    /// Whether the endpoint answered Macro's signed validation request.
    /// Nothing is pushed to an endpoint until it has.
    pub verified: bool,
}

/// An agent persona whose runtime lives outside Macro.
#[derive(Debug, Clone)]
pub struct ExternalAgent {
    /// The agent's bot identity, used for DMs, mentions, and its replies.
    pub bot: Bot,
    /// Where its events are pushed. `None` while its runtime polls for them.
    pub endpoint: Option<AgentEndpoint>,
}

/// Request to register an external agent.
#[derive(Debug, Clone)]
pub struct RegisterExternalAgent {
    /// Owning team. `None` for an agent private to the caller.
    pub team_id: Option<Uuid>,
    /// Display name.
    pub name: String,
    /// `@` handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// URL to push the agent's events to. `None` when its runtime polls.
    pub endpoint_url: Option<String>,
}

/// What registering hands the agent's operator. Shown once.
#[derive(Debug, Clone)]
pub struct RegisteredExternalAgent {
    /// The registered agent.
    pub agent: ExternalAgent,
    /// Bot token the runtime authenticates with.
    pub bot_token: String,
    /// Secret every push to the endpoint is signed with, when it has one.
    pub signing_secret: Option<String>,
}

/// An external agent after its endpoint changed.
#[derive(Debug, Clone)]
pub struct EndpointChange {
    /// The agent, with its new endpoint.
    pub agent: ExternalAgent,
    /// Signing secret of a newly created endpoint. Shown once.
    pub signing_secret: Option<String>,
}

/// The endpoint's answer to Macro's signed validation request.
#[derive(Debug, Clone)]
pub struct EndpointVerification {
    /// The agent, with the endpoint's new verification state.
    pub agent: ExternalAgent,
    /// HTTP status the endpoint answered with, when it answered.
    pub response_status: Option<u16>,
    /// Why verification failed, when it did.
    pub message: Option<String>,
}

/// How a message addressed an external agent.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    strum::Display,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ExternalAgentEventKind {
    /// A turn in someone's direct conversation with the agent.
    DirectMessage,
    /// A message that mentioned the agent.
    Mention,
}

/// A message that addressed an external agent, as recorded in its inbox.
///
/// The event is also what authorizes the agent's reply: the reply goes to
/// [`Self::reply_thread_id`] in [`Self::parent`], written with the current
/// access of [`Self::invoking_user`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalAgentEvent {
    /// UUIDv7 event id, ordering the agent's inbox.
    pub id: Uuid,
    /// The agent addressed.
    pub bot_id: BotId,
    /// How it was addressed.
    pub kind: ExternalAgentEventKind,
    /// The conversation the message is in.
    pub parent: MessageParent,
    /// The message.
    pub message_id: Uuid,
    /// The thread the message is in; `None` for a root message.
    pub message_thread_id: Option<Uuid>,
    /// Where the agent's reply goes; `None` on a direct conversation's timeline.
    pub reply_thread_id: Option<Uuid>,
    /// Who posted the message.
    pub sender_id: String,
    /// Whose access the agent's reply is written with.
    pub invoking_user: MacroUserIdStr<'static>,
    /// Macro Markdown body.
    pub content: String,
    /// When the message was posted.
    pub message_created_at: DateTime<Utc>,
}

/// The body Macro pushes to an external agent's endpoint, and the event
/// the SDK hands to its handlers.
#[derive(Debug, Clone, Serialize)]
pub struct MessageEventEnvelope<'a> {
    /// Event id. Reply and typing calls name it; receivers deduplicate on it.
    pub event_id: Uuid,
    /// [`MESSAGE_EVENT_SCHEMA_VERSION`].
    pub schema_version: u8,
    /// [`MESSAGE_EVENT_TYPE`].
    pub event_type: &'static str,
    /// The message.
    pub metadata: MessageEventMetadata<'a>,
}

/// [`MessageEventEnvelope`]'s payload.
#[derive(Debug, Clone, Serialize)]
pub struct MessageEventMetadata<'a> {
    /// The agent addressed.
    pub agent_id: BotId,
    /// How it was addressed.
    pub kind: ExternalAgentEventKind,
    /// The conversation, as `{"type": "channel", "id": "..."}`.
    pub conversation: &'a MessageParent,
    /// The message.
    pub message: EventMessage<'a>,
}

/// The message in a [`MessageEventEnvelope`].
#[derive(Debug, Clone, Serialize)]
pub struct EventMessage<'a> {
    /// Message id.
    pub id: Uuid,
    /// Its thread; `None` for a root message.
    pub thread_id: Option<Uuid>,
    /// Who posted it.
    pub sender_id: &'a str,
    /// Macro Markdown body.
    pub text: &'a str,
    /// When it was posted.
    pub created_at: DateTime<Utc>,
}

impl ExternalAgentEvent {
    /// The event as pushed to the agent's endpoint.
    #[must_use]
    pub fn envelope(&self) -> MessageEventEnvelope<'_> {
        MessageEventEnvelope {
            event_id: self.id,
            schema_version: MESSAGE_EVENT_SCHEMA_VERSION,
            event_type: MESSAGE_EVENT_TYPE,
            metadata: MessageEventMetadata {
                agent_id: self.bot_id,
                kind: self.kind,
                conversation: &self.parent,
                message: EventMessage {
                    id: self.message_id,
                    thread_id: self.message_thread_id,
                    sender_id: &self.sender_id,
                    text: &self.content,
                    created_at: self.message_created_at,
                },
            },
        }
    }
}

/// A reply an external agent posts to one of its events.
#[derive(Debug, Clone)]
pub struct AgentReply {
    /// The event being answered.
    pub event_id: Uuid,
    /// Macro Markdown body.
    pub content: String,
    /// UUIDv7 the runtime minted for this reply, so a retry cannot post it
    /// twice. The server mints one when absent.
    pub message_id: Option<Uuid>,
}

/// Where a reply was posted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostedReply {
    /// The posted message.
    pub message_id: Uuid,
    /// The conversation it was posted in.
    pub parent: MessageParent,
    /// The thread it was posted in; `None` on a direct conversation's timeline.
    pub thread_id: Option<Uuid>,
}
