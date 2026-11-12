//! Bounded channel change-log retention.

use super::*;
use crate::domain::changes::ChannelChangeLogPruner;

impl ChannelChangeLogPruner for PgMessageRepository {
    #[tracing::instrument(name = "messages.prune_channel_change_batch", skip_all, fields(batch = batch as i64, removed = tracing::field::Empty), err)]
    async fn prune_channel_change_log(
        &self,
        cutoff: DateTime<Utc>,
        batch: usize,
    ) -> Result<usize, MessageError> {
        let limit = i64::try_from(batch)
            .map_err(|_| MessageError::Invalid("channel change prune batch is too large"))?;
        let mut tx = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(database_error)?;
        let removed = channel_change_db_utils::prune_in(&mut tx, cutoff, limit)
            .await
            .map_err(database_error)?;
        tx.commit().await.map_err(database_error)?;
        let removed = usize::try_from(removed)
            .map_err(|_| MessageError::Invalid("pruned channel row count overflows"))?;
        tracing::Span::current().record("removed", removed as i64);
        Ok(removed)
    }
}
