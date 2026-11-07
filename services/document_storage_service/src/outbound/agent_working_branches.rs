//! Soup's agent working-branch port, served by the agent changes domain.

use agent_changes::domain::{model::AgentSessionId, ports::SessionBranchReader};
use soup::domain::ports::{AgentWorkingBranch, AgentWorkingBranches, AgentWorkingBranchesFuture};
use uuid::Uuid;

/// Captured branch facts from the changes store, in Soup's terms.
pub(crate) struct ChangesetWorkingBranches<R>(pub(crate) R);

impl<R: SessionBranchReader> AgentWorkingBranches for ChangesetWorkingBranches<R> {
    fn working_branches<'a>(&'a self, sessions: &'a [Uuid]) -> AgentWorkingBranchesFuture<'a> {
        Box::pin(async move {
            let sessions: Vec<_> = sessions
                .iter()
                .copied()
                .map(AgentSessionId::new_from_uuid)
                .collect();
            let branches = self.0.working_branches(&sessions).await?;
            Ok(branches
                .into_iter()
                .map(|(session, captured)| {
                    (
                        session.as_uuid(),
                        AgentWorkingBranch {
                            repository_url: captured.repository_url,
                            branch: captured.branch,
                        },
                    )
                })
                .collect())
        })
    }
}
