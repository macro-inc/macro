use async_graphql::{Enum, ID, SimpleObject};
use bots::domain::models::BotOwner;
use external_agents::domain::models::{
    AgentEndpoint, EndpointChange, EndpointVerification, ExternalAgent, ExternalAgentEvent,
    ExternalAgentEventKind, PostedReply, RegisteredExternalAgent,
};

/// An agent persona whose runtime lives outside Macro. People DM and
/// mention it like any agent; its runtime reads those messages from its
/// inbox and answers them with its bot token.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgent {
    /// The agent's bot id: the id it is DMed and mentioned by, and answers as.
    pub id: ID,
    /// Display name.
    pub name: String,
    /// `@` handle.
    pub handle: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional avatar URL.
    pub avatar_url: Option<String>,
    /// Owning team; null for an agent private to the person who created it.
    pub team_id: Option<ID>,
    /// Where its events are pushed; null while its runtime polls for them.
    pub endpoint: Option<GraphqlExternalAgentEndpoint>,
    /// RFC 3339 creation time.
    pub created_at: String,
}

impl From<ExternalAgent> for GraphqlExternalAgent {
    fn from(agent: ExternalAgent) -> Self {
        let bot = agent.bot;
        Self {
            id: ID(bot.id.to_string()),
            name: bot.name,
            handle: bot.handle,
            description: bot.description,
            avatar_url: bot.avatar_url,
            team_id: match bot.owner {
                Some(BotOwner::Team { team_id }) => Some(ID(team_id.to_string())),
                Some(BotOwner::User { .. }) | None => None,
            },
            endpoint: agent.endpoint.map(Into::into),
            created_at: bot.created_at.to_rfc3339(),
        }
    }
}

/// The webhook endpoint an external agent's events are pushed to, signed
/// with its secret.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgentEndpoint {
    /// URL the events are posted to.
    pub url: String,
    /// Whether the endpoint answered Macro's signed validation request.
    /// Nothing is pushed to it until it has.
    pub verified: bool,
}

impl From<AgentEndpoint> for GraphqlExternalAgentEndpoint {
    fn from(endpoint: AgentEndpoint) -> Self {
        Self {
            url: endpoint.url,
            verified: endpoint.verified,
        }
    }
}

/// A newly registered external agent and its credentials, shown once.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlRegisteredExternalAgent {
    /// The agent.
    pub agent: GraphqlExternalAgent,
    /// Bot token its runtime authenticates with, in `x-macro-bot-token`.
    pub bot_token: String,
    /// Secret its endpoint's pushes are signed with; null without an endpoint.
    pub signing_secret: Option<String>,
}

impl From<RegisteredExternalAgent> for GraphqlRegisteredExternalAgent {
    fn from(registered: RegisteredExternalAgent) -> Self {
        Self {
            agent: registered.agent.into(),
            bot_token: registered.bot_token,
            signing_secret: registered.signing_secret,
        }
    }
}

/// An external agent after its endpoint changed.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgentEndpointChange {
    /// The agent, with its new endpoint.
    pub agent: GraphqlExternalAgent,
    /// Signing secret of a newly created endpoint, shown once; null when the
    /// endpoint kept its secret or was removed.
    pub signing_secret: Option<String>,
}

impl From<EndpointChange> for GraphqlExternalAgentEndpointChange {
    fn from(change: EndpointChange) -> Self {
        Self {
            agent: change.agent.into(),
            signing_secret: change.signing_secret,
        }
    }
}

/// The endpoint's answer to Macro's signed validation request.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgentEndpointVerification {
    /// The agent, with the endpoint's new verification state.
    pub agent: GraphqlExternalAgent,
    /// HTTP status the endpoint answered with; null when it did not answer.
    pub response_status: Option<i32>,
    /// Why verification failed, when it did.
    pub message: Option<String>,
}

impl From<EndpointVerification> for GraphqlExternalAgentEndpointVerification {
    fn from(verification: EndpointVerification) -> Self {
        Self {
            agent: verification.agent.into(),
            response_status: verification.response_status.map(i32::from),
            message: verification.message,
        }
    }
}

/// How a message addressed an external agent.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum GraphqlExternalAgentEventKind {
    /// A turn in someone's direct conversation with the agent.
    DirectMessage,
    /// A message that mentioned the agent.
    Mention,
}

impl From<ExternalAgentEventKind> for GraphqlExternalAgentEventKind {
    fn from(kind: ExternalAgentEventKind) -> Self {
        match kind {
            ExternalAgentEventKind::DirectMessage => Self::DirectMessage,
            ExternalAgentEventKind::Mention => Self::Mention,
        }
    }
}

/// A message that addressed an external agent: one event in its inbox,
/// the same event its endpoint is pushed. Answer it with
/// `replyToExternalAgentEvent`.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgentEvent {
    /// Event id, ordering the inbox; pass the last one read as `after`.
    pub id: ID,
    /// How the message addressed the agent.
    pub kind: GraphqlExternalAgentEventKind,
    /// Type of the conversation: `channel`, `document`, `call`, and so on.
    pub conversation_type: String,
    /// Id of the conversation.
    pub conversation_id: ID,
    /// The message.
    pub message_id: ID,
    /// The thread the message is in; null for a root message.
    pub thread_id: Option<ID>,
    /// Who posted the message.
    pub sender_id: String,
    /// Macro Markdown body.
    pub text: String,
    /// RFC 3339 time the message was posted.
    pub sent_at: String,
}

impl From<ExternalAgentEvent> for GraphqlExternalAgentEvent {
    fn from(event: ExternalAgentEvent) -> Self {
        Self {
            id: ID(event.id.to_string()),
            kind: event.kind.into(),
            conversation_type: event.parent.entity_type().to_owned(),
            conversation_id: ID(event.parent.entity_id()),
            message_id: ID(event.message_id.to_string()),
            thread_id: event.message_thread_id.map(|id| ID(id.to_string())),
            sender_id: event.sender_id,
            text: event.content,
            sent_at: event.message_created_at.to_rfc3339(),
        }
    }
}

/// Where an external agent's reply was posted.
#[derive(Debug, Clone, SimpleObject)]
pub struct GraphqlExternalAgentReply {
    /// The posted message.
    pub message_id: ID,
    /// Type of the conversation it was posted in.
    pub conversation_type: String,
    /// Id of the conversation it was posted in.
    pub conversation_id: ID,
    /// The thread it was posted in; null on a direct conversation's timeline.
    pub thread_id: Option<ID>,
}

impl From<PostedReply> for GraphqlExternalAgentReply {
    fn from(reply: PostedReply) -> Self {
        Self {
            message_id: ID(reply.message_id.to_string()),
            conversation_type: reply.parent.entity_type().to_owned(),
            conversation_id: ID(reply.parent.entity_id()),
            thread_id: reply.thread_id.map(|id| ID(id.to_string())),
        }
    }
}
