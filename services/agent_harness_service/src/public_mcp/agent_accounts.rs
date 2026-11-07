//! Account facts from the team-agent domain's existing repository.
use agent_inmem::domain::tool_mode::AgentAccounts;
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin};
use team_agents::domain::ports::TeamAgentRepository;

pub struct Accounts<R>(pub R);
impl<R: TeamAgentRepository> AgentAccounts for Accounts<R> {
    fn is_teammate<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<bool, agent_inmem::domain::tool_mode::AgentAccountError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            self.0
                .get(user)
                .await
                .map(|agent| agent.is_some())
                .map_err(|_| agent_inmem::domain::tool_mode::AgentAccountError)
        })
    }
}
