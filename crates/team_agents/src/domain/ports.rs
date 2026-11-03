//! Ports for the team agents domain.

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    BrainLaunch, CreateTeamAgent, EmailMessages, Mailbox, NewAgentAccount, SendEmail, SentEmail,
    TeamAgent, TeamAgentError,
};

/// Storage for agent accounts and profiles.
pub trait TeamAgentRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Creates the agent's Macro account (verified, no sign-in) and its
    /// profile, atomically.
    fn create_account(
        &self,
        account: &NewAgentAccount,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Deletes the agent's account and everything that cascades from it.
    fn delete_account(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Records the brain's bot and first session.
    fn set_brain(
        &self,
        user_id: &MacroUserIdStr<'_>,
        bot_id: Uuid,
        session_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The agent with this user id, if the account is a team agent.
    fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamAgent>, Self::Err>> + Send;

    /// The agent's mailbox id, if it has one.
    fn mailbox_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Adds an agent account to a team.
pub trait TeamMembership: Send + Sync + 'static {
    /// Adds the account to the receipt's team, as any member joins.
    fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// Mints the agent's own API key.
pub trait AgentApiKeys: Send + Sync + 'static {
    /// Mints a key for the agent and returns its secret.
    fn mint(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<String, TeamAgentError>> + Send;
}

/// The agents' email provider.
pub trait Mailboxes: Send + Sync + 'static {
    /// Creates a mailbox for `username`, shown as `display_name`.
    fn create(
        &self,
        username: &str,
        display_name: &str,
    ) -> impl Future<Output = Result<Mailbox, TeamAgentError>> + Send;

    /// Deletes a mailbox.
    fn delete(&self, mailbox_id: &str) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Lists a mailbox's newest emails.
    fn list(
        &self,
        mailbox_id: &str,
        limit: u8,
    ) -> impl Future<Output = Result<EmailMessages, TeamAgentError>> + Send;

    /// Reads one email with its body.
    fn get(
        &self,
        mailbox_id: &str,
        message_id: &str,
    ) -> impl Future<Output = Result<super::models::EmailMessage, TeamAgentError>> + Send;

    /// Sends an email from a mailbox.
    fn send(
        &self,
        mailbox_id: &str,
        email: &SendEmail,
    ) -> impl Future<Output = Result<SentEmail, TeamAgentError>> + Send;
}

/// Starts an agent's brain on its runtime.
pub trait BrainLauncher: Send + Sync + 'static {
    /// Creates the agent's coding-agent bot on the runtime, acting as the
    /// agent. Returns the bot id.
    fn bind(
        &self,
        api_key: &str,
        name: &str,
        harness_id: Uuid,
        team_id: Uuid,
        model: &str,
    ) -> impl Future<Output = Result<Uuid, TeamAgentError>> + Send;

    /// Starts the brain's first session and sends it the setup prompt. The
    /// runtime can take minutes to open a session, so this returns at once
    /// and the launch continues in the background.
    fn start(&self, launch: BrainLaunch);
}

/// Inbound port: what drivers (HTTP) can ask of team agents.
pub trait TeamAgentService: Send + Sync + 'static {
    /// Creates a team agent on the receipt's team and starts its brain.
    fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// The calling agent's own profile.
    fn me(
        &self,
        caller: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// The calling agent's newest emails.
    fn list_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        limit: u8,
    ) -> impl Future<Output = Result<EmailMessages, TeamAgentError>> + Send;

    /// One of the calling agent's emails, with its body.
    fn get_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        message_id: &str,
    ) -> impl Future<Output = Result<super::models::EmailMessage, TeamAgentError>> + Send;

    /// Sends an email as the calling agent.
    fn send_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        email: SendEmail,
    ) -> impl Future<Output = Result<SentEmail, TeamAgentError>> + Send;
}
