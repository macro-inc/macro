//! Storage entry points for consumers with their own entity and authorization.

use super::*;
use crate::domain::models::DatabaseId;
use crate::domain::ports::DatabaseStorage;

impl<Properties> DatabaseStorage for PgCellStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseOptionWriter
        + DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    type Error = PgCellStoreError;

    #[tracing::instrument(err, skip(self))]
    async fn create_storage(&self) -> Result<DatabaseId, Self::Error> {
        let id = DatabaseId::new();
        sqlx::query!("INSERT INTO database (id) VALUES ($1)", id.into_uuid())
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_storage(&self, id: DatabaseId) -> Result<(), Self::Error> {
        let mut transaction = self.pool.begin().await?;
        schema::lock_database(&mut transaction, id, true).await?;
        journal::purge(&mut *transaction, id).await?;
        sqlx::query!("DELETE FROM database WHERE id = $1", id.into_uuid())
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, writes), fields(writes = writes.writes.len()))]
    async fn apply_storage_writes(&self, writes: &Writes) -> Result<WritesOutcome, Self::Error> {
        self.apply_in(self.pool.begin().await?, writes).await
    }
}
