//! Account facts from the team-agent domain's existing repository.
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin};
use team_agents::domain::ports::TeamAgentRepository;

/// Account facts could not be loaded; never assume a different identity.
#[derive(Debug, thiserror::Error)]
#[error("agent account lookup unavailable")]
pub struct AgentAccountError;

/// Account facts resolved by the server, never from MCP client headers.
pub trait AgentAccounts: Send + Sync {
    /// Whether this authenticated user is an agent teammate.
    fn is_teammate<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AgentAccountError>> + Send + 'a>>;
}

pub struct Accounts<R>(pub R);
impl<R: TeamAgentRepository> AgentAccounts for Accounts<R> {
    fn is_teammate<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AgentAccountError>> + Send + 'a>> {
        Box::pin(async move {
            self.0
                .get(user)
                .await
                .map(|agent| agent.is_some())
                .map_err(|_| AgentAccountError)
        })
    }
}
