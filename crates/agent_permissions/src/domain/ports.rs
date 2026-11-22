//! What the service needs from outside: storage, the agents and sessions
//! directories, and the rollout.

use std::future::Future;

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::model::{
    AgentAccess, Change, PermissionError, PolicyId, PolicyOwner, Rule, SessionFacts, SetBy,
};

/// Saved settings and session overlays.
pub trait PermissionStore: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The id of `owner`'s policy, created (with no settings) when it has
    /// none yet. Concurrent calls for one owner return the same id.
    fn ensure_policy(
        &self,
        owner: &PolicyOwner,
    ) -> impl Future<Output = Result<PolicyId, Self::Err>> + Send;

    /// A policy's saved settings.
    fn rules(&self, policy: PolicyId) -> impl Future<Output = Result<Vec<Rule>, Self::Err>> + Send;

    /// A session's overlay.
    fn session_rules(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<Rule>, Self::Err>> + Send;

    /// A policy's saved settings and a session's overlay, as one snapshot:
    /// a write committing between the two reads can't pair the saved rules
    /// before it with the overlay after it.
    fn rules_with_session(
        &self,
        policy: PolicyId,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(Vec<Rule>, Vec<Rule>), Self::Err>> + Send;

    /// Change a policy or a session's overlay in one transaction: lock the
    /// policy (and the session, when `write.session` names one) against every
    /// other write, read its rules and the overlay, ask `plan` for the
    /// changes, and save them to `write.to`. A change with `state: None`
    /// deletes the row. When `plan` refuses, nothing is written and its error
    /// is returned inside `Ok`.
    fn write<Plan>(
        &self,
        write: Write<'_>,
        plan: Plan,
    ) -> impl Future<Output = Result<Result<(), PermissionError>, Self::Err>> + Send
    where
        Plan: FnOnce(&[Rule], &[Rule]) -> Result<Vec<Change>, PermissionError> + Send;

    /// Delete every saved setting of a policy, under the same lock as
    /// [`PermissionStore::write`]. Session overlays stay.
    fn reset(&self, policy: PolicyId) -> impl Future<Output = Result<(), Self::Err>> + Send;
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
