//! Store runtime branch facts under the session's ownership fence.

use super::*;
use crate::domain::repository_branch::RepositoryBranch;
use crate::domain::working_branch::{SessionWorkingBranchRepo, WorkingBranchWrite};

impl SessionWorkingBranchRepo for PgAgentSessionRepo {
    async fn record_working_branch(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        expected_repository_url: &str,
        branch: &RepositoryBranch,
        claim: Option<SessionClaim>,
    ) -> Result<WorkingBranchWrite> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin working branch update")?;
        let locked = sqlx::query!(
            r#"
            SELECT repo_url, manager_replica_id, manager_fence
            FROM agent_session WHERE id = $1 AND owner_id = $2
            FOR UPDATE
            "#,
            session.as_uuid(),
            owner.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .context("lock session working branch")?
        .ok_or(AgentSessionError::Forbidden)?;
        if let Some(claim) = claim
            && (claim.session != session
                || locked.manager_replica_id != Some(claim.replica.as_uuid())
                || locked.manager_fence != claim.fence.0)
        {
            return Err(AgentSessionError::FencedOut(session));
        }
        if locked.repo_url.as_deref() != Some(expected_repository_url) {
            return Ok(WorkingBranchWrite::RepositoryChanged);
        }
        let updated = sqlx::query!(
            r#"
            UPDATE agent_session SET working_branch = $2, modified_at = clock_timestamp()
            WHERE id = $1 AND working_branch IS DISTINCT FROM $2
            "#,
            session.as_uuid(),
            branch.as_str(),
        )
        .execute(&mut *transaction)
        .await
        .context("persist session working branch")?;
        transaction
            .commit()
            .await
            .context("commit working branch update")?;
        Ok(if updated.rows_affected() == 1 {
            WorkingBranchWrite::Changed
        } else {
            WorkingBranchWrite::Unchanged
        })
    }
}
