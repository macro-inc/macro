//! What the service needs from outside: storage, the agents and sessions
//! directories, and the rollout.

use std::future::Future;

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::model::{
    AgentAccess, AgentFacts, AgentScope, Change, PermissionError, PolicyChain, PolicyId,
    PolicyOwner, Rule, SessionFacts, SetBy, TeamFacts, TeamRole,
};

/// Saved settings, the policies they follow, and session overlays.
pub trait PermissionStore: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The id of `owner`'s policy, created (owning no settings) when it has
    /// none yet. Concurrent calls for one owner return the same id.
    fn ensure_policy(
        &self,
        owner: &PolicyOwner,
    ) -> impl Future<Output = Result<PolicyId, Self::Err>> + Send;

    /// The id of `owner`'s policy, when it has one.
    fn find_policy(
        &self,
        owner: &PolicyOwner,
    ) -> impl Future<Output = Result<Option<PolicyId>, Self::Err>> + Send;

    /// The id of the owned agent `agent`'s policy, created following `source`
    /// (a root: a persona's or a team's policy, so no cycle or depth check is
    /// needed) when it has none yet. One that exists is returned as it is.
    fn ensure_following_policy(
        &self,
        agent: BotId,
        source: PolicyId,
    ) -> impl Future<Output = Result<PolicyId, Self::Err>> + Send;

    /// A policy, every policy it follows and each one's saved settings, as
    /// one consistent read; `None` when there is no such policy. A stored
    /// chain longer than [`MAX_CHAIN`](super::model::MAX_CHAIN) or a cycle
    /// is an error.
    fn chain(
        &self,
        policy: PolicyId,
    ) -> impl Future<Output = Result<Option<PolicyChain>, Self::Err>> + Send;

    /// A session's overlay.
    fn session_rules(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<Rule>, Self::Err>> + Send;

    /// A policy's chain and a session's overlay, as one snapshot: a write,
    /// a source change or a detach committing meanwhile is seen entirely or
    /// not at all. `None` when there is no such policy.
    fn chain_with_session(
        &self,
        policy: PolicyId,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<(PolicyChain, Vec<Rule>)>, Self::Err>> + Send;

    /// Change a policy or a session's overlay in one transaction: lock the
    /// policy (and the session, when `write.session` names one) against every
    /// other write, read its chain and the overlay, ask `plan` for the
    /// changes, and save them to `write.to`. A change with `state: None`
    /// deletes the row. When `plan` refuses, nothing is written and its error
    /// is returned inside `Ok`.
    fn write<Plan>(
        &self,
        write: Write<'_>,
        plan: Plan,
    ) -> impl Future<Output = Result<Result<(), PermissionError>, Self::Err>> + Send
    where
        Plan: FnOnce(&PolicyChain, &[Rule]) -> Result<Vec<Change>, PermissionError> + Send;

    /// Delete every saved setting of a policy, under the same lock as
    /// [`PermissionStore::write`]. What it follows, and session overlays,
    /// stay.
    fn reset(&self, policy: PolicyId) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Make `write.policy` follow `source`, in one transaction under the
    /// lock every source change takes (so two changes can't each pass the
    /// cycle check the other breaks), then the policy's own lock. Refused
    /// inside `Ok`: [`SourceNotAllowed`](PermissionError::SourceNotAllowed)
    /// when the policy is not an owned agent's or is `source` itself,
    /// [`NotFound`](PermissionError::NotFound) when either policy is
    /// missing, [`SourceCycle`](PermissionError::SourceCycle) when `source`'s
    /// chain reaches the policy, and
    /// [`SourceTooDeep`](PermissionError::SourceTooDeep) when the policy's
    /// longest follower path and `source`'s chain together would exceed
    /// [`MAX_CHAIN`](super::model::MAX_CHAIN). A policy that owned its
    /// settings loses those a person made; its restrictions stay, as local
    /// restrictions.
    fn set_source(
        &self,
        write: SourceWrite<'_>,
        source: PolicyId,
    ) -> impl Future<Output = Result<Result<(), PermissionError>, Self::Err>> + Send;

    /// Make `write.policy` own its settings again, in one transaction under
    /// the sources lock and then the policy's: read its chain, ask `plan` for
    /// the rows it keeps (the snapshot, `resolve::materialize`, plus any
    /// changes), replace its rows with them and clear its source. When `plan`
    /// refuses, nothing changes and its error is returned inside `Ok`; else
    /// how many rows it wrote.
    fn detach<Plan>(
        &self,
        write: SourceWrite<'_>,
        plan: Plan,
    ) -> impl Future<Output = Result<Result<usize, PermissionError>, Self::Err>> + Send
    where
        Plan: FnOnce(&PolicyChain) -> Result<Vec<Rule>, PermissionError> + Send;

    /// The ids of these owned agents' policies, in the order given, `None`
    /// for one that has none yet, in one read.
    fn find_agent_policies(
        &self,
        agents: &[BotId],
    ) -> impl Future<Output = Result<Vec<Option<PolicyId>>, Self::Err>> + Send;

    /// The most policies on any path of followers ending at `policy`, itself
    /// included (1 when nothing follows it), counted no further than one
    /// past [`MAX_CHAIN`](super::model::MAX_CHAIN).
    fn followers_height(
        &self,
        policy: PolicyId,
    ) -> impl Future<Output = Result<usize, Self::Err>> + Send;
}

/// What a [`PermissionStore::set_source`] or [`PermissionStore::detach`]
/// changes, and who.
#[derive(Debug, Clone, Copy)]
pub struct SourceWrite<'a> {
    /// The follower.
    pub policy: PolicyId,
    /// The person making the change.
    pub by: &'a MacroUserIdStr<'static>,
}

/// What a [`PermissionStore::write`] reads, locks and saves to.
#[derive(Debug, Clone, Copy)]
pub struct Write<'a> {
    /// The policy, always read and locked.
    pub policy: PolicyId,
    /// The session whose overlay is read and locked too.
    pub session: Option<AgentSessionId>,
    /// Where the changes go.
    pub to: WriteTo,
    /// Who made them (the person an agent acts for).
    pub by: &'a MacroUserIdStr<'static>,
    /// Who made them, which the saved rows record.
    pub set_by: SetBy,
}

/// Where a write's changes are saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteTo {
    /// The policy's saved settings.
    Saved,
    /// `session`'s overlay (restrictions only).
    Session(AgentSessionId),
}

/// Who may edit an agent: the same rule as editing the agent itself.
pub trait AgentDirectory: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// What `user` may do with `agent`.
    fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> impl Future<Output = Result<AgentAccess, Self::Err>> + Send;

    /// An owned agent's owner and identity, a deleted one's included; `None`
    /// when there is no such agent.
    fn facts(
        &self,
        agent: BotId,
    ) -> impl Future<Output = Result<Option<AgentFacts>, Self::Err>> + Send;

    /// The live agents `user` may edit whose policies a follower in `scope`
    /// could follow: for a private scope, the person's own and their teams'
    /// agents; for a team, that team's.
    fn source_candidates(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: &AgentScope,
    ) -> impl Future<Output = Result<Vec<AgentFacts>, Self::Err>> + Send;
}

/// Teams: a person's role in one, the teams they belong to, a team's name.
pub trait TeamDirectory: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// `user`'s role in `team`; `None` when they are not a member.
    fn role(
        &self,
        user: &MacroUserIdStr<'static>,
        team: Uuid,
    ) -> impl Future<Output = Result<Option<TeamRole>, Self::Err>> + Send;

    /// The teams `user` belongs to.
    fn teams(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<TeamFacts>, Self::Err>> + Send;

    /// A team's name; `None` when there is no such team.
    fn team(&self, team: Uuid)
    -> impl Future<Output = Result<Option<TeamFacts>, Self::Err>> + Send;
}

/// The facts about a session that decide whose permissions apply in it.
pub trait SessionDirectory: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The session's agent and owner, or `None` when there is no such session.
    fn facts(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<SessionFacts>, Self::Err>> + Send;
}

/// The feature's per-user rollout.
pub trait PermissionsRollout: Send + Sync + 'static {
    /// Whether agent permissions are on for `user`. Off when it can't be told.
    fn enabled(&self, user: &MacroUserIdStr<'static>) -> impl Future<Output = bool> + Send;
}
