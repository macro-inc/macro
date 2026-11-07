//! DM contexts belong in their channel, independently of warm runtime lifecycle.

use super::error::Result;

/// Owning session persistence capability for an existing DM context backfill.
pub trait SessionListVisibilityRepo: Send + Sync {
    /// Hide at most `limit` DM contexts, leaving other sessions and channels alone.
    fn hide_dm_sessions(&self, limit: u16) -> impl Future<Output = Result<u64>> + Send;
}

/// Default-off until every old hidden/unthreaded warm reaper has been replaced.
#[derive(Debug, Clone, Copy, Default)]
pub struct SessionListPolicy {
    /// Enable DM context hiding after the warm-marker rollout is complete.
    pub hide_agent_dms: bool,
}

const BACKFILL_BATCH_SIZE: u16 = 256;

impl SessionListPolicy {
    /// Repair earlier contexts and contexts created by a replica still using the
    /// disabled policy. Bounded and retryable, so enabling across replicas is safe.
    pub async fn reconcile(self, repo: &impl SessionListVisibilityRepo) -> Result<()> {
        if self.hide_agent_dms {
            repo.hide_dm_sessions(BACKFILL_BATCH_SIZE).await?;
        }
        Ok(())
    }
}
