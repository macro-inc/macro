use crate::domain::{models::OrphanedAttachment, ports::OrphanRepository};

pub(crate) struct PostgresOrphanRepository {
    db: sqlx::PgPool,
}

impl PostgresOrphanRepository {
    pub(crate) fn new(db: sqlx::PgPool) -> Self {
        Self { db }
    }
}

impl OrphanRepository for PostgresOrphanRepository {
    type Error = sqlx::Error;

    async fn find_orphaned(&self) -> Result<Vec<OrphanedAttachment>, Self::Error> {
        sqlx::query_as!(
            OrphanedAttachment,
            r#"
        SELECT
            id as "db_id", sfs_id
        FROM email_attachments_sfs
        WHERE
            attachment_id IS NULL
        "#,
        )
        .fetch_all(&self.db)
        .await
    }
}
