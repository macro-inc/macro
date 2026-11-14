//! Duplicates: the new database, its owner's grant and everything copied
//! into it commit in one transaction.

use super::*;
use crate::domain::duplicate::DatabaseDuplicateRepo;
use crate::domain::models::Database;
use crate::outbound::pg_databases_repo::insert_owned_entity;

impl<Properties> DatabaseDuplicateRepo for PgCellStore<Properties>
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

    #[tracing::instrument(err, skip(self, database, writes), fields(database_id = %database.id, writes = writes.writes.len()))]
    async fn duplicate_database(
        &self,
        database: &Database,
        writes: &Writes,
    ) -> Result<WritesOutcome, Self::Error> {
        // Returning before the commit drops the transaction, which rolls
        // the new database back with everything else.
        let mut transaction = self.pool.begin().await?;
        insert_owned_entity(
            &mut transaction,
            database.id,
            &database.name,
            &database.owner_id,
            Some(database.created_at),
            database.appearance.as_ref(),
        )
        .await?;
        if !rows::lock_live_database(&mut transaction, writes.database_id).await? {
            return Ok(missing_database(writes));
        }
        self.apply_in(transaction, writes).await
    }
}
