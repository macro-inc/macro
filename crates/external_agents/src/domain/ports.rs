//! External agent ports.

use agent_trigger::domain::broker_events::AgentTriggerTopicEvent;
use bot_id::BotId;
use bots::domain::models::{Agent, BotOwner, CreateAgentRequest};
use entity_access::domain::models::EntityAccessReceipt;
use macro_event_broker::Event;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{models::MessageParent, service::MessageWrite};
use uuid::Uuid;

use super::models::{
    AgentEndpoint, AgentReply, EndpointChange, EndpointVerification, ExternalAgent,
    ExternalAgentEvent, PostedReply, RegisterExternalAgent, RegisteredExternalAgent,
};

/// External agent error.
#[derive(Debug, thiserror::Error)]
pub enum ExternalAgentError {
    /// The request is invalid.
    #[error("{0}")]
    BadRequest(String),
    /// No such agent or event, or nothing the caller may act on.
    #[error("not found")]
    NotFound,
    /// The caller may not act on this agent.
    #[error("unauthorized")]
    Unauthorized,
    /// A message with the reply's id already exists.
    #[error("a message with this id already exists")]
    Conflict,
    /// A dependency failed.
    #[error("external agent operation failed")]
    Internal(rootcause::Report),
}

/// External agent result.
pub type Result<T, E = ExternalAgentError> = std::result::Result<T, E>;

/// The personas external agents are, as the bots domain keeps them.
pub trait AgentPersonas: Send + Sync + 'static {
    /// Create an agent owned by the caller or a team they belong to.
    fn create(
        &self,
        caller: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> impl Future<Output = Result<Agent>> + Send;

    /// A live agent the caller may change.
    fn manageable(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<Agent>> + Send;

    /// Every agent the caller may change.
    fn list(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Agent>>> + Send;

    /// Delete a manageable agent.
    fn delete(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Mint a bot token for a manageable agent, returning the raw token.
    fn issue_token(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> impl Future<Output = Result<String>> + Send;
}

/// A newly created endpoint and the secret its pushes are signed with.
#[derive(Debug, Clone)]
pub struct CreatedEndpoint {
    /// The endpoint.
    pub endpoint: AgentEndpoint,
    /// Signing secret, returned only on creation.
    pub signing_secret: String,
}

/// The endpoint's answer to a validation request.
#[derive(Debug, Clone)]
pub struct EndpointCheck {
    /// Whether the endpoint is now verified.
    pub verified: bool,
    /// HTTP status the endpoint answered with, when it answered.
    pub response_status: Option<u16>,
    /// Why verification failed, when it did.
    pub message: Option<String>,
}

/// Webhook endpoints external agents' events are pushed to.
pub trait AgentEndpoints: Send + Sync + 'static {
    /// Create an endpoint for `bot_id` in the owner's workspace.
    fn create(
        &self,
        caller: MacroUserIdStr<'static>,
        owner: &BotOwner,
        bot_id: BotId,
        name: &str,
        url: String,
    ) -> impl Future<Output = Result<CreatedEndpoint>> + Send;

    /// The endpoint behind `webhook_id`; `None` once it is gone.
    fn get(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
    ) -> impl Future<Output = Result<Option<AgentEndpoint>>> + Send;

    /// Point the endpoint at `url`. It must be verified again.
    fn set_url(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
        url: String,
    ) -> impl Future<Output = Result<AgentEndpoint>> + Send;

    /// Send the endpoint a signed validation request and record its answer.
    fn verify(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
    ) -> impl Future<Output = Result<EndpointCheck>> + Send;

    /// Remove the endpoint. Removing one that is already gone succeeds.
    fn delete(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: &str,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Queue `event` for signed, retried delivery to the endpoint. Queuing
    /// the same event again delivers it once.
    fn push(
        &self,
        webhook_id: &str,
        event: &ExternalAgentEvent,
    ) -> impl Future<Output = Result<()>> + Send;
}

/// A registered external agent, as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalAgentRow {
    /// The agent's bot.
    pub bot_id: BotId,
    /// The webhook its events are pushed to; `None` while its runtime polls.
    pub webhook_id: Option<String>,
}

/// External agents and their inboxes.
pub trait ExternalAgentRepo: Send + Sync + 'static {
    /// Record `bot_id` as an external agent, pushed to `webhook_id` if any.
    fn register(
        &self,
        bot_id: BotId,
        webhook_id: Option<&str>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Change where `bot_id`'s events are pushed.
    fn set_webhook(
        &self,
        bot_id: BotId,
        webhook_id: Option<&str>,
    ) -> impl Future<Output = Result<()>> + Send;

    /// These bots' registrations, for those that are external agents.
    fn get(&self, bot_ids: &[BotId]) -> impl Future<Output = Result<Vec<ExternalAgentRow>>> + Send;

    /// Forget `bot_id`, and with it its inbox.
    fn remove(&self, bot_id: BotId) -> impl Future<Output = Result<()>> + Send;

    /// Record `event` unless its trigger was recorded already, returning the
    /// stored event either way.
    fn record(
        &self,
        event: ExternalAgentEvent,
        trigger_event_id: Uuid,
    ) -> impl Future<Output = Result<ExternalAgentEvent>> + Send;

    /// `bot_id`'s events after `after`, oldest first.
    fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<ExternalAgentEvent>>> + Send;

    /// One of `bot_id`'s events.
    fn event(
        &self,
        bot_id: BotId,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<ExternalAgentEvent>>> + Send;
}

/// Agents' capability to write into conversations for a person.
pub trait AgentWriteAccess: Send + Sync + 'static {
    /// `bot_id`'s capability to write into `parent` for `user`, minted on
    /// that person's current access; `None` when they may not write there.
    fn bot_write(
        &self,
        bot_id: BotId,
        user: MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> impl Future<Output = Result<Option<EntityAccessReceipt<MessageWrite>>>> + Send;
}

/// Registering and managing external agents, for the people who own them.
#[async_trait::async_trait]
pub trait ExternalAgentRegistry: Send + Sync + 'static {
    /// Create an agent on the external harness and mint its bot token. With
    /// an endpoint URL, its events are pushed there, and the endpoint is
    /// asked to verify itself; registration succeeds either way.
    async fn register(
        &self,
        caller: MacroUserIdStr<'static>,
        req: RegisterExternalAgent,
    ) -> Result<RegisteredExternalAgent>;

    /// The external agents the caller may manage.
    async fn list(&self, caller: MacroUserIdStr<'static>) -> Result<Vec<ExternalAgent>>;

    /// Push the agent's events to `url`, or stop pushing them with `None`
    /// so its runtime polls. A new or moved endpoint must verify itself.
    async fn set_endpoint(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
        url: Option<String>,
    ) -> Result<EndpointChange>;

    /// Ask the agent's endpoint to verify itself again.
    async fn verify_endpoint(
        &self,
        caller: MacroUserIdStr<'static>,
        bot_id: BotId,
    ) -> Result<EndpointVerification>;

    /// Mint another bot token for the agent. Earlier tokens keep working
    /// until revoked.
    async fn issue_token(&self, caller: MacroUserIdStr<'static>, bot_id: BotId)
    -> Result<String>;

    /// Delete the agent, then its endpoint and inbox.
    async fn delete(&self, caller: MacroUserIdStr<'static>, bot_id: BotId) -> Result<()>;
}

/// An external agent's own API, called by its runtime with its bot token.
#[async_trait::async_trait]
pub trait ExternalAgentApi: Send + Sync + 'static {
    /// The agent's events after `after`, oldest first, at most `limit`.
    async fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        limit: u16,
    ) -> Result<Vec<ExternalAgentEvent>>;

    /// Post `reply` where its event expects the answer, with the current
    /// access of the person who addressed the agent.
    async fn reply(&self, bot_id: BotId, reply: AgentReply) -> Result<PostedReply>;

    /// Show, or stop showing, the agent typing where its answer will appear.
    async fn set_typing(&self, bot_id: BotId, event_id: Uuid, active: bool) -> Result<()>;
}

/// Recording the messages that addressed external agents.
pub trait ExternalAgentInbox: Send + Sync + 'static {
    /// Record a trigger for an external agent in its inbox and push it to
    /// its endpoint. Triggers for other agents, and the ones carrying no
    /// message, are ignored. Safe to repeat for a redelivered trigger.
    fn record_trigger(
        &self,
        trigger: &Event<AgentTriggerTopicEvent>,
    ) -> impl Future<Output = Result<()>> + Send;
}
