use super::*;
use crate::domain::repository_branch::RepositoryBranch;
use crate::domain::working_branch::{SessionWorkingBranchRepo, WorkingBranchWrite};

impl SessionWorkingBranchRepo for InMemoryAgentSessionRepo {
    async fn record_working_branch(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        expected_repository_url: &str,
        branch: &RepositoryBranch,
        claim: Option<SessionClaim>,
    ) -> Result<WorkingBranchWrite> {
        let leases = self.leases.lock().unwrap();
        if let Some(claim) = claim
            && (claim.session != session
                || !leases.get(&session).is_some_and(|(replica, fence)| {
                    *replica == Some(claim.replica) && *fence == claim.fence.0
                }))
        {
            return Err(AgentSessionError::FencedOut(session));
        }
        let mut sessions = self.sessions.lock().unwrap();
        let stored = sessions
            .get_mut(&session)
            .filter(|stored| stored.owner_id.is_user(owner))
            .ok_or(AgentSessionError::Forbidden)?;
        if stored.repo_url.as_deref() != Some(expected_repository_url) {
            return Ok(WorkingBranchWrite::RepositoryChanged);
        }
        let mut branches = self.working_branches.lock().unwrap();
        if branches.get(&session).map(String::as_str) == Some(branch.as_str()) {
            return Ok(WorkingBranchWrite::Unchanged);
        }
        branches.insert(session, branch.as_str().to_owned());
        stored.modified_at = chrono::Utc::now();
        Ok(WorkingBranchWrite::Changed)
    }
}
