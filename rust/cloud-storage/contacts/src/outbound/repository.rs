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
        let rows = sqlx::query!(
            "
            SELECT user1 AS contact FROM contacts_connections WHERE user2 = $1
            UNION
            SELECT user2 AS contact FROM contacts_connections WHERE user1 = $1
            ",
            user_id
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows.into_iter().filter_map(|r| r.contact).collect())
    }

    async fn create_connections(
        &self,
        connections: Vec<(String, String)>,
    ) -> Result<(), anyhow::Error> {
        let (users1, users2): (Vec<String>, Vec<String>) = connections
            .into_iter()
            .map(|(a, b)| if a <= b { (a, b) } else { (b, a) })
            .unzip();

        sqlx::query!(
            "
            INSERT INTO contacts_connections(user1, user2)
            SELECT * FROM unnest($1::text[], $2::text[])
            ON CONFLICT(user1, user2) DO UPDATE SET updated_at = now()
            ",
            &users1,
            &users2
        )
        .execute(&self.db)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "couldn't create connections");
        })?;

        Ok(())
    }
}
