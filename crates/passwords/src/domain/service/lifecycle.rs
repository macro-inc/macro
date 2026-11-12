//! Team namespace deletion and explicit item/TOTP erasure; membership never erases values.
use super::*;
impl PasswordService {
    /// Internal requests require rollout even for empty vaults; callers prove emptiness before RPC.
    #[tracing::instrument(skip_all,err,name="passwords.team.purge",fields(team_id=%team.0,outcome=tracing::field::Empty))]
    pub async fn purge_team(&self, team: TeamId) -> Result<(), Error> {
        self.availability.require_service_enabled().await?;
        let _lease = self.repository.lock(team, ItemId(Uuid::nil())).await?;
        self.availability.require_service_enabled().await?;
        self.repository.close_team(team).await?;
        self.provider.purge_namespace(team).await?;
        self.repository.purge_team_metadata(team).await?;
        tracing::Span::current().record("outcome", "purged");
        Ok(())
    }

    /// Retry explicit item deletions whose provider erasure has not completed.
    #[tracing::instrument(skip_all,err,name="passwords.items.cleanup",fields(completed=tracing::field::Empty,failed=tracing::field::Empty))]
    pub async fn cleanup_retired_items(&self) -> Result<usize, Error> {
        self.availability.require_service_enabled().await?;
        let mut completed = 0;
        let mut failed = 0;
        for (team, item) in self.repository.item_cleanup_due().await? {
            let result = match tokio::time::timeout(
                CLEANUP_ATTEMPT_TIMEOUT,
                self.erase_retired_item(team, item),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => Err(Error::Unavailable),
            };
            match result {
                Ok(true) => completed += 1,
                Ok(false) => {}
                Err(error) => {
                    failed += 1;
                    tracing::warn!(team_id=%team.0,item_id=%item.0,error=%error,"passwords explicit item erasure failed; retained for retry");
                }
            }
        }
        tracing::Span::current().record("completed", completed);
        tracing::Span::current().record("failed", failed);
        Ok(completed)
    }

    #[tracing::instrument(skip_all,err,name="passwords.item.erase",fields(team_id=%team.0,item_id=%item.0,outcome=tracing::field::Empty))]
    async fn erase_retired_item(&self, team: TeamId, item: ItemId) -> Result<bool, Error> {
        let _lease = match self.repository.lock(team, item).await {
            Ok(lease) => lease,
            Err(Error::Busy) => {
                tracing::Span::current().record("outcome", "contended");
                return Ok(false);
            }
            Err(error) => return Err(error),
        };
        self.erase_retired_record(team, item).await
    }

    #[tracing::instrument(skip_all,err,name="passwords.item.erase_provider",fields(team_id=%team.0,item_id=%item.0,outcome=tracing::field::Empty))]
    pub(super) async fn erase_retired_record(
        &self,
        team: TeamId,
        item: ItemId,
    ) -> Result<bool, Error> {
        self.availability.require_service_enabled().await?;
        let record = match self.repository.get(team, item).await {
            Ok(record) => record,
            Err(Error::NotFound) => return Ok(false),
            Err(error) => return Err(error),
        };
        if !record.deleting {
            return Ok(false);
        }
        self.repository.retire_totp(team, item, None).await?;
        for key in self.repository.totp_keys(team, item).await? {
            self.provider.delete_totp(team, key).await?;
        }
        self.provider.delete(team, item).await?;
        self.repository.delete(team, item).await?;
        tracing::Span::current().record("outcome", "erased");
        Ok(true)
    }
    #[tracing::instrument(skip_all,err,name="passwords.totp.erase",fields(team_id=%cleanup.team_id.0,key_id=%cleanup.key_id.0,outcome=tracing::field::Empty))]
    pub(super) async fn erase_retired_totp(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        let _lease = match self.repository.lock(cleanup.team_id, cleanup.item_id).await {
            Ok(lease) => lease,
            Err(Error::Busy) => {
                tracing::Span::current().record("outcome", "contended");
                return Ok(false);
            }
            Err(error) => return Err(error),
        };
        self.availability.require_service_enabled().await?;
        if !self.repository.totp_cleanup_ready(cleanup).await? {
            tracing::Span::current().record("outcome", "quarantined");
            return Ok(false);
        }
        self.provider
            .delete_totp(cleanup.team_id, cleanup.key_id)
            .await?;
        self.repository.finish_totp_cleanup(cleanup).await?;
        tracing::Span::current().record("outcome", "erased");
        Ok(true)
    }
}

#[cfg(test)]
mod test;
