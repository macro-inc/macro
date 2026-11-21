//! Ports for agent teammates.

use std::future::Future;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, MemberTeamRole};
use hosted_runtimes::domain::{
    agent::{AgentEnrollment, AgentEnrollmentError},
    enrollment::EnrollmentGeneration,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::admission::AgentAccountFacts;
use super::avatar::AgentAvatar;
use super::models::{
    AgentApiKey, AgentReady, AgentRepo, ComputerDetails, ComputerId, ComputerPurchase,
    ComputerState, CreateTeamAgent, CreatedAccount, NewAgentAccount, PersonaSeed, TeamAgent,
    TeamAgentError, TeamAgentRecord, TeamAgents, VoiceModel,
};
use super::self_hosting::{
    Checkpoint, CreatedInstall, HostFacts, IssuedInstall, MoveTeammate, NewTeammateInstall,
    TeammateHosts, TeammateInstallRecord,
};
use super::voice::AgentVoice;
use harness_id::HarnessId;

/// Agent accounts and their `team_agents` rows.
pub trait TeamAgentRepository: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create the account (no sign-in, marked as an agent) and its
    /// `team_agents` row in one transaction. When the team already has an
    /// agent with the account's purchase key, creates nothing and returns
    /// that agent, including while another request is still creating it.
    fn create_account(
        &self,
        account: &NewAgentAccount,
    ) -> impl Future<Output = Result<CreatedAccount, Self::Err>> + Send;

    /// Delete the account; its `team_agents` row, membership and repo row
    /// cascade. Only to undo an invite that failed: a removed agent keeps
    /// its account, see [`Self::remove_seat`].
    fn delete_account(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the agent's `team_agents` row, so nothing admits it as an
    /// agent any more. Its account and everything it owns stay; nothing
    /// references the row.
    fn remove_seat(
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

    /// Stamp the agent's first report of being online; a later report
    /// keeps the first time.
    fn mark_online(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically replace both avatar columns for an agent still on this team.
    /// Returns false when it was removed or moved before the write.
    fn set_avatar(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        avatar: &AgentAvatar,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Best-effort publication of saved avatar changes to connected clients.
pub trait AgentPictureChanges: Send + Sync + 'static {
    /// Publish after persistence succeeds. Failures are logged by the adapter
    /// and never turn a successful save into a failed request.
    fn picture_changed(&self, agent: &MacroUserIdStr<'_>, url: Option<&str>);
}

/// What an agent's own account says about it, for admission.
pub trait AgentAccounts: Send + Sync + 'static {
    /// Storage failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The account's facts, or none if it has no `team_agents` row.
    fn account_facts(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<AgentAccountFacts>, Self::Err>> + Send;
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

    /// [`Self::remove_agent`] with no admin's receipt, for taking back an
    /// agent whose computer was released after failing its first start. An
    /// agent no longer on
    /// the team is success.
    fn take_back_agent(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
        removed_by: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The agent's own Macro API key.
pub trait AgentApiKeys: Send + Sync + 'static {
    /// Revoke every key the agent has; it can't call Macro afterwards.
    fn revoke_all(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

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

    /// The computer's name and harness, for the agent's ready notice.
    fn details(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<ComputerDetails, TeamAgentError>> + Send;

    /// Refuse `buyer` when the computers rollout doesn't include them, before
    /// anything is created for the purchase.
    fn require_purchase_rollout(
        &self,
        buyer: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Release the computer now; an already released one is success.
    fn release(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// The agent the computer runs reported itself online, which ends the
    /// computer's first start. Telling it again changes nothing.
    fn agent_online(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// A counted delivery whose install row stays locked until
/// [`CountedDelivery::release`]: racing issuers wait on it, so credentials
/// are minted in delivery order and the highest pair holds the live key.
pub trait CountedDelivery: Send {
    /// The `(generation, delivery)` to mint for.
    fn pair(&self) -> (u64, u64);

    /// Keep the count and let the next issuer go. Dropped unreleased, the
    /// count is undone.
    fn release(self) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// Agents' installs on their owners' own machines, and those machines.
pub trait TeammateInstalls: Send + Sync + 'static {
    /// A delivery counted by [`TeammateInstalls::next_delivery`].
    type Delivery: CountedDelivery;

    /// Create the agent's install. When the agent already has one, creates
    /// nothing and returns it: one install per agent, whoever races.
    fn create(
        &self,
        install: &NewTeammateInstall,
    ) -> impl Future<Output = Result<CreatedInstall, TeamAgentError>> + Send;

    /// The agent's install, if it has one.
    fn for_agent(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// The installs of those of `agents` that have one, in one read.
    fn for_agents(
        &self,
        agents: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// An install by its id.
    fn by_id(
        &self,
        install_id: Uuid,
    ) -> impl Future<Output = Result<Option<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Mark the agent's install as waiting on its machine to stop it, keeping
    /// when an earlier checkpoint started; a later move retargets it, and a
    /// removal overrides a move. `None` when it has no install.
    fn begin_checkpoint(
        &self,
        agent: &MacroUserIdStr<'_>,
        checkpoint: Checkpoint,
    ) -> impl Future<Output = Result<Option<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Finish a move of install `install_id`: the target machine, the new
    /// install id, the next generation, nothing delivered yet. `None` when
    /// that install isn't moving (finished already, or removed).
    fn finish_move(
        &self,
        install_id: Uuid,
        new_install_id: Uuid,
    ) -> impl Future<Output = Result<Option<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Count the next delivery of `install_id` on `harness`, when the
    /// machine's last known `(generation, delivery)` is behind the row's and
    /// no checkpoint is pending, recording the runtime image id it carries.
    /// The row stays locked until the delivery is released, so a racing
    /// caller waits, then counts its own delivery. `None` when there is
    /// nothing to deliver.
    fn next_delivery(
        &self,
        install_id: Uuid,
        harness: HarnessId,
        reported: (u64, u64),
        image_id: &str,
    ) -> impl Future<Output = Result<Option<Self::Delivery>, TeamAgentError>> + Send;

    /// The machines `owner` paired and owns (never Macro computers), by
    /// name, with their latest hosting reports.
    fn hosts_of(
        &self,
        owner: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<HostFacts>, TeamAgentError>> + Send;

    /// One machine, whoever owns it.
    fn host(
        &self,
        harness: HarnessId,
    ) -> impl Future<Output = Result<Option<HostFacts>, TeamAgentError>> + Send;

    /// Whether `harness` may still host an agent of `team_id`: it is paired
    /// (not deleted) and its owner is still an owner or admin of the team.
    fn host_entitled(
        &self,
        harness: HarnessId,
        team_id: Uuid,
    ) -> impl Future<Output = Result<bool, TeamAgentError>> + Send;

    /// Up to `limit` installs, not already being removed, on (or moving to)
    /// a machine that may no longer host them (see
    /// [`TeammateInstalls::host_entitled`]).
    fn unentitled_installs(
        &self,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Park the agent's install: no machine hosts it, nothing is delivered,
    /// any move is cancelled, and its credentials are due for revoking
    /// ([`TeammateInstallRecord::revoke_pending`]). Waits for a delivery in
    /// flight to be released, so a revoke after it voids that key too.
    /// `None` when it has no install or is being removed.
    fn park(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// The agent's credentials were revoked: deliveries may resume.
    fn revoked(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Up to `limit` installs whose credentials are still due for revoking.
    fn revoke_pending(
        &self,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Every install of `team_id`'s agents.
    fn of_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<TeammateInstallRecord>, TeamAgentError>> + Send;

    /// Delete the agent's install; a missing one is success.
    fn delete(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// Telling the machines' service that a machine's installs changed, so the
/// replica holding its socket delivers or stops them now. Best effort: a
/// machine that misses it catches up when it next connects.
pub trait TeammateRuntimes: Send + Sync + 'static {
    /// `harness`'s installs changed.
    fn installs_changed(&self, harness: HarnessId) -> impl Future<Output = ()> + Send;
}

/// Telling an agent's inviter that the agent is up.
pub trait AgentReadyNotices: Send + Sync + 'static {
    /// Deliver `notice`. Delivering it again must not notify twice.
    fn send(&self, notice: AgentReady) -> impl Future<Output = Result<(), TeamAgentError>> + Send;
}

/// The computer-facing addresses an agent's brain uses, resolved per
/// enrollment.
pub trait EnrollmentEnvironment: Send + Sync + 'static {
    /// Variable name and value pairs, all single lines.
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError>;
}

/// Agent teammates.
pub trait TeamAgentService: Send + Sync + 'static {
    /// Replace an agent's face and PNG, or save a photo and clear the face.
    fn set_avatar(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        avatar: AgentAvatar,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

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

    /// Remove an agent: release its computer, revoke its keys and repo
    /// token, take it off the team and delete its seat. Its account and
    /// everything it owns stay. Not gated by the rollout, so an admin can
    /// always stop billing.
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

    /// The calling agent reports that it is online. The first report makes
    /// it `running` and tells its inviter it is ready; later ones change
    /// nothing. Refused for an account that isn't an agent of the receipt's
    /// team.
    fn agent_online(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// The acting admin's own machines, each with whether it can host a
    /// teammate now.
    fn hosts(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> impl Future<Output = Result<TeammateHosts, TeamAgentError>> + Send;

    /// Move an agent on an own machine to another of the admin's own
    /// machines. The machine it leaves stops it first (its last push), then
    /// a new install runs on the target with fresh credentials.
    fn move_install(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        request: MoveTeammate,
    ) -> impl Future<Output = Result<TeamAgent, TeamAgentError>> + Send;

    /// Fresh credentials for the next delivery of an install on `harness`,
    /// for the replica holding that machine's socket, given the
    /// `(generation, delivery)` the machine last said it runs (`None`:
    /// nothing). `None` when the install is gone, elsewhere, moving, not
    /// behind, or its agent's rollout is off. Each issue retires the agent's
    /// previous key.
    fn issue_install(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> impl Future<Output = Result<Option<IssuedInstall>, AgentEnrollmentError>> + Send;

    /// The machine stopped install `install_id` for its move or removal, or
    /// the wait gave up: finish the move (new install on the target), or the
    /// removal (keys, repo token, team, seat, and the install last). An
    /// install with nothing pending is done.
    fn finish_checkpoint(
        &self,
        install_id: Uuid,
    ) -> impl Future<Output = Result<(), TeamAgentError>> + Send;

    /// Take every agent off machines that may no longer host it: the
    /// owner left the team or lost admin, or unpaired the machine. Each is
    /// parked: it loses its credentials at once and its machine stops it,
    /// and it keeps its account, seat and repository until an admin moves
    /// it to a machine of theirs. Also retries every revoke that failed
    /// before. How many were taken off.
    fn offboard_unentitled_hosts(
        &self,
    ) -> impl Future<Output = Result<usize, TeamAgentError>> + Send;

    /// The agent part of a computer's enrollment: fresh credentials and its
    /// environment, or `None` when the computer runs no agent.
    fn issue_enrollment(
        &self,
        computer_id: ComputerId,
        generation: EnrollmentGeneration,
    ) -> impl Future<Output = Result<Option<AgentEnrollment>, AgentEnrollmentError>> + Send;
}
