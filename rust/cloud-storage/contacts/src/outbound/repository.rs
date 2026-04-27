use crate::domain::ports::ContactsRepository;
use sqlx::PgPool;

/// Database-backed implementation of [`ContactsRepository`].
pub struct DbContactsRepository {
    /// The PostgreSQL connection pool.
    pub db: PgPool,
}

impl DbContactsRepository {
    /// Creates a new repository with the given connection pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl ContactsRepository for DbContactsRepository {
    async fn get_contacts(&self, user_id: &str) -> Result<Vec<String>, anyhow::Error> {
        let contacts = contacts_db_client::get_contacts(&self.db, user_id).await?;
        Ok(contacts)
    }

    async fn create_connections(
        &self,
        connections: Vec<(String, String)>,
    ) -> Result<(), anyhow::Error> {
        let mut transaction = self.db.begin().await?;
        contacts_db_client::create_connections(transaction.as_mut(), connections)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "couldn't create connections");
            })?;
        transaction.commit().await.inspect_err(|e| {
            tracing::error!(error=?e, "transaction error");
        })?;
        Ok(())
    }
}
