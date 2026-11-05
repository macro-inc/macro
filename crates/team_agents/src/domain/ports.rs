//! Ports for the team agents domain.

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    AgentRepo, ComputerPurchase, ComputerQuote, ComputerSize, ComputerStatus, CreateTeamAgent,
    Credential, EmailMessage, EmailMessages, Mailbox, NewAgentAccount, Persona, PersonaSeed,
    SeatQuote, SendEmail, SentEmail, SubscriptionItem, TeamAgent, TeamAgentError, TeamAgentQuote,
    TeamAgentStatus, TeamAgents,
};

/// Storage for agent accounts and their provisioning status.
pub trait TeamAgentRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Creates the agent's Macro account (verified, no sign-in) and its
    /// `team_agents` row, atomically.
    fn create_account(
        &self,
        account: &NewAgentAccount,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Deletes the agent's account and everything that cascades from it.
    fn delete_account(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The agent with this user id, if the account is a team agent.
    fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamAgent>, Self::Err>> + Send;

    /// A team's agents, oldest first.
    fn list_for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<TeamAgent>, Self::Err>> + Send;

    /// Original workspace seed, absent on accounts created before recovery.
    fn persona_seed(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<PersonaSeed>, Self::Err>> + Send;

    /// The agent's mailbox id, if it has one.
    fn mailbox_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Records the computer bought for the agent.
    fn set_computer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Records where the agent's computer is.
    fn set_status(
        &self,
        user_id: &MacroUserIdStr<'_>,
        status: TeamAgentStatus,
        reason: Option<&str>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The agent's membership and seat on its team.
pub trait TeamMembership: Send + Sync + 'static {
    /// Adds the account to the receipt's team without touching the team
    /// subscription. Returns the seat to add in the computer purchase's
    /// Stripe update, or `None` when the team does not bill seats.
    fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<SubscriptionItem>, TeamAgentError>> + Send;

    /// Takes back an [`Self::add_agent`] membership whose seat was never billed.
    fn undo_add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Removes a billed agent from the team, seat included. Removing one that
    /// is no longer a member succeeds.
    fn remove_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// What the seat [`Self::add_agent`] adds costs, or `None` when the team
    /// does not bill seats.
    fn quote_seat(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> impl Future<Output = Result<Option<SeatQuote>, TeamAgentError>> + Send;
}

/// Mints the agent's own API key.
pub trait AgentApiKeys: Send + Sync + 'static {
    /// Mints a key for the agent and returns its secret.
    fn mint(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Credential, TeamAgentError>> + Send;
}

/// The agents' email provider.
pub trait Mailboxes: Send + Sync + 'static {
    /// Creates a mailbox for `username`, shown as `display_name`.
    fn create(
        &self,
        username: &str,
        display_name: &str,
    ) -> impl Future<Output = Result<Mailbox, TeamAgentError>> + Send;

    /// Deletes a mailbox. A missing mailbox counts as deleted.
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
    ) -> impl Future<Output = Result<EmailMessage, TeamAgentError>> + Send;

    /// Sends an email from a mailbox.
    fn send(
        &self,
        mailbox_id: &str,
        email: &SendEmail,
    ) -> impl Future<Output = Result<SentEmail, TeamAgentError>> + Send;
}

/// Macro computers (hosted runtimes) bought on a team's subscription.
pub trait Computers: Send + Sync + 'static {
    /// What a computer of `size` costs the team.
    fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> impl Future<Output = Result<ComputerQuote, TeamAgentError>> + Send;

    /// Buys a computer with one Stripe update that also adds
    /// `extra_items`. This is the commit point: an error means
    /// nothing was charged or created.
    fn purchase(
        &self,
        purchase: ComputerPurchase,
    ) -> impl Future<Output = Result<Uuid, TeamAgentError>> + Send;

    /// One of the team's computers.
    fn status(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<ComputerStatus, TeamAgentError>> + Send;

    /// Original bootstrap persona, scoped to the owning team.
    fn persona(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<Persona, TeamAgentError>> + Send;

    /// Re-drive provisioning on the existing paid computer without a purchase.
    fn retry(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<ComputerStatus, TeamAgentError>> + Send;

    /// Releases the computer now and stops billing it. Releasing one already
    /// gone succeeds.
    fn release(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The agents' workspace repos (one per agent, Macro-hosted git).
pub trait AgentRepos: Send + Sync + 'static {
    /// Creates the agent's repo from the persona template.
    fn create(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> impl Future<Output = Result<AgentRepo, TeamAgentError>> + Send;

    /// Recreate a missing repo or return its original credential without
    /// rotating a live one. The token comes from the saved computer persona.
    fn ensure(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
        token: &Credential,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Deletes the agent's repo. A missing repo counts as deleted.
    fn delete(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// Inbound port: what drivers (HTTP) can ask of team agents.
pub trait TeamAgentService: Send + Sync + 'static {
    /// What inviting an agent with a computer of `size` adds to the bill.
    fn quote(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        size: ComputerSize,
    ) -> impl Future<Output = Result<TeamAgentQuote, TeamAgentError>> + Send;

    /// Invites a team agent to the receipt's team and buys its computer.
    fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// The receipt team's agents, with fresh computer status.
    fn list(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> impl Future<Output = Result<TeamAgents, TeamAgentError>> + Send;

    /// Re-drive a failed agent from its saved persona and existing computer.
    fn retry(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// Deletes an agent: its computer, repo, seat, mailbox and account.
    fn delete(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// The calling agent's own profile, with fresh computer status.
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
    ) -> impl Future<Output = Result<EmailMessage, TeamAgentError>> + Send;

    /// Sends an email as the calling agent.
    fn send_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        email: SendEmail,
    ) -> impl Future<Output = Result<SentEmail, TeamAgentError>> + Send;
}
