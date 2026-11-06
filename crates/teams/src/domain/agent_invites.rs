//! Rollout authorization for legacy agent-account invitations.

use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin};

/// Boxed rollout decision shared by team service instances.
pub type AgentInviteDecision<'a> = Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

/// Allows agent invitations without affecting ordinary human invitations.
pub trait AgentInviteRollout: std::fmt::Debug + Send + Sync + 'static {
    /// Load one snapshot for the authenticated inviter; failures deny access.
    fn enabled<'a>(&'a self, caller: &'a MacroUserIdStr<'_>) -> AgentInviteDecision<'a>;
}

/// An unwired service cannot invite agent accounts.
#[derive(Debug)]
pub struct DisabledAgentInvites;

impl AgentInviteRollout for DisabledAgentInvites {
    fn enabled<'a>(&'a self, _: &'a MacroUserIdStr<'_>) -> AgentInviteDecision<'a> {
        Box::pin(async { false })
    }
}
