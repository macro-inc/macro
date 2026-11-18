//! What the service needs from outside: storage, the agents and sessions
//! directories, and the rollout.

use std::future::Future;

use agent_fold::domain::log::AgentSessionId;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;

use super::model::{AgentAccess, Change, PolicyOwner, Rule, SessionFacts};

/// Saved settings and session overlays. Every write applies all its changes
/// in one transaction; a change with `state: None` deletes the row.
pub trait PermissionStore: Send + Sync + 'static {
    /// The adapter's error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// A policy's saved settings.
    fn rules(
        &self,
        owner: &PolicyOwner,
    ) -> impl Future<Output = Result<Vec<Rule>, Self::Err>> + Send;

    /// A session's overlay.
    fn session_rules(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<Rule>, Self::Err>> + Send;

    /// Save normalized `changes` to a policy, as set by `by`; `via_agent`
    /// when the agent restricted itself.
    fn apply(
        &self,
        owner: &PolicyOwner,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
        via_agent: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Save normalized `changes` (restrictions or removals) to a session's
    /// overlay.
    fn apply_session(
        &self,
        session: AgentSessionId,
        changes: &[Change],
        by: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete every saved setting of a policy. Session overlays stay.
    fn reset(&self, owner: &PolicyOwner) -> impl Future<Output = Result<(), Self::Err>> + Send;
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
