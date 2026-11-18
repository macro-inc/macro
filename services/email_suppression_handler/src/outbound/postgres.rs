use crate::domain::ports::SuppressionStore;

pub(crate) struct PostgresSuppressionStore {
    db: sqlx::PgPool,
}

impl PostgresSuppressionStore {
    pub(crate) fn new(db: sqlx::PgPool) -> Self {
        Self { db }
    }
}

impl SuppressionStore for PostgresSuppressionStore {
    async fn bulk_upsert_block_email(&self, emails: &[&str]) -> anyhow::Result<()> {
        macro_db_client::blocked_email::bulk_upsert_block_email(&self.db, emails).await
    }
}
