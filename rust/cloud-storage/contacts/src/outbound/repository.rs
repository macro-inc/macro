#[cfg(test)]
mod test;

use crate::domain::ports::ContactsRepository;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
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
    async fn get_contacts(&self, user_id: &str) -> Result<Vec<String>, Report> {
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

    async fn create_connections<'a>(
        &self,
        connections: impl Iterator<Item = (MacroUserIdStr<'a>, MacroUserIdStr<'a>)> + Send,
    ) -> Result<(), Report> {
        let (users1, users2): (Vec<MacroUserIdStr<'a>>, Vec<MacroUserIdStr<'a>>) = connections
            .map(|(a, b)| {
                if a.as_ref() <= b.as_ref() {
                    (a, b)
                } else {
                    (b, a)
                }
            })
            .unzip();

        let u1: Vec<&str> = users1.iter().map(|u| u.as_ref()).collect();
        let u2: Vec<&str> = users2.iter().map(|u| u.as_ref()).collect();

        sqlx::query!(
            "
            INSERT INTO contacts_connections(user1, user2)
            SELECT * FROM unnest($1::text[], $2::text[])
            ON CONFLICT(user1, user2) DO UPDATE SET updated_at = now()
            ",
            &u1 as &[&str],
            &u2 as &[&str]
        )
        .execute(&self.db)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "couldn't create connections");
        })?;

        Ok(())
    }
}
