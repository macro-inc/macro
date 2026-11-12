//! Ports for agent teammates.

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, MemberTeamRole};
use hosted_runtimes::domain::{
    agent::{AgentEnrollment, AgentEnrollmentError},
    enrollment::EnrollmentGeneration,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    AgentApiKey, AgentRepo, ComputerId, ComputerPurchase, ComputerState, CreateTeamAgent,
    NewAgentAccount, PersonaSeed, TeamAgent, TeamAgentError, TeamAgentRecord, TeamAgents,
    VoiceModel,
};
use super::voice::AgentVoice;

/// Agent accounts and their `team_agents` rows.
pub trait TeamAgentRepository: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create the account (no sign-in, marked as an agent) and its
    /// `team_agents` row in one transaction.
    fn create_account(
        &self,
        account: &NewAgentAccount,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the account; its `team_agents` row, membership and repo row
    /// cascade.
    fn delete_account(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// One agent, if the account is one.
    fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamAgentRecord>, Self::Err>> + Send;

    /// A team's agents, oldest first.
    fn list_for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<TeamAgentRecord>, Self::Err>> + Send;
}

/// Team membership through the teams domain.
pub trait TeamMembership: Send + Sync + 'static {
    /// Join the agent to the receipt's team with an included seat.
    fn add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Take back [`Self::add_agent`] after a later step failed.
    fn undo_add_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Remove the agent from the team through the normal removal path.
    fn remove_agent(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The agent's own Macro API key.
pub trait AgentApiKeys: Send + Sync + 'static {
    /// Mint a new key, replacing the agent's previous one.
    fn mint(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentApiKey, TeamAgentError>> + Send;
}

/// The agent's workspace repository.
pub trait AgentRepos: Send + Sync + 'static {
    /// Create the repository from the seed, or keep an existing one, and
    /// issue a new token; the previous token stops working.
    fn create(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        seed: &PersonaSeed,
    ) -> impl Future<Output = Result<AgentRepo, TeamAgentError>> + Send;

    /// Delete the repository; a missing one is success.
    fn delete(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// The voice committed in the agent's repository, if it has a valid one.
    fn voice(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<VoiceModel>, TeamAgentError>> + Send;

    /// Commit a voice to the agent's repository as Macro.
    fn set_voice(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        voice: &VoiceModel,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The agent's Macro computer, through hosted_runtimes.
pub trait Computers: Send + Sync + 'static {
    /// Buy a computer for the agent through the normal purchase path.
    fn purchase(
        &self,
        purchase: ComputerPurchase,
    ) -> impl Future<Output = Result<ComputerId, TeamAgentError>> + Send;

    /// The team's computer bought for this agent, if any.
    fn computer_for_agent(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<ComputerId>, TeamAgentError>> + Send;

    /// The agent a computer runs, if any.
    fn agent_of(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, TeamAgentError>> + Send;

    /// Where the computer is.
    fn state(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<ComputerState, TeamAgentError>> + Send;

    /// Release the computer now; an already released one is success.
    fn release(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The computer-facing addresses an agent's brain uses, resolved per
/// enrollment.
pub trait EnrollmentEnvironment: Send + Sync + 'static {
    /// Variable name and value pairs, all single lines.
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError>;
}

/// Agent teammates.
pub trait TeamAgentService: Send + Sync + 'static {
    /// Invite an agent teammate: its account, team membership, workspace
    /// repository and computer. Undoes everything before the purchase if a
    /// step fails.
    fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// The receipt team's agents.
    fn list(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<TeamAgents, TeamAgentError>> + Send;

    /// Remove an agent: release its computer, take it off the team, and
    /// delete its repository and account.
    fn delete(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// The voice an agent on the receipt's team speaks with on calls.
    fn voice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AgentVoice, TeamAgentError>> + Send;

    /// Change the voice of an agent on the receipt's team; it applies from
    /// the agent's next call.
    fn set_voice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        voice: AgentVoice,
    ) -> impl Future<Output = Result<AgentVoice, TeamAgentError>> + Send;

    /// The agent part of a computer's enrollment: fresh credentials and its
    /// environment, or `None` when the computer runs no agent.
    fn issue_enrollment(
        &self,
        computer_id: ComputerId,
        generation: EnrollmentGeneration,
    ) -> impl Future<Output = Result<Option<AgentEnrollment>, AgentEnrollmentError>> + Send;
}
