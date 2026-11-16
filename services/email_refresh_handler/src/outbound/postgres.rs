use sqlx::types::uuid;
use sqlx::{Pool, Postgres, Type};

use crate::domain::ports::LinkRepository;

#[derive(Type, Debug, Clone, Copy)]
#[sqlx(type_name = "email_user_provider_enum", rename_all = "UPPERCASE")]
enum DbUserProvider {
    Gmail,
    /// Microsoft Outlook and Microsoft 365.
    Outlook,
}

pub(crate) struct PostgresLinkRepository {
    db: Pool<Postgres>,
}

impl PostgresLinkRepository {
    pub(crate) fn new(db: Pool<Postgres>) -> Self {
        Self { db }
    }
}

impl LinkRepository for PostgresLinkRepository {
    type Error = sqlx::Error;

    async fn fetch_refresh_link_ids(
        &self,
        current_hour: i32,
    ) -> Result<Vec<uuid::Uuid>, Self::Error> {
        let provider_filter = DbUserProvider::Gmail;
        // uses the index idx_links_active_provider_hash_bucket
        sqlx::query_scalar!(
            r#"
        SELECT
            id as "link_id"
        FROM email_links
        WHERE
            is_sync_active = TRUE
            AND provider = $1
            AND (abs(hashtext(id::text)) % 24) = $2
        "#,
            provider_filter as _,
            current_hour
        )
        .fetch_all(&self.db)
        .await
    }

    async fn fetch_health_check_link_ids(
        &self,
        interval_hours: i32,
        bucket: i32,
    ) -> Result<Vec<uuid::Uuid>, Self::Error> {
        let provider_filter = DbUserProvider::Gmail;
        // uses the index idx_links_active_provider_hash_bucket
        sqlx::query_scalar!(
            r#"
        SELECT
            id as "link_id"
        FROM email_links
        WHERE
            is_sync_active = TRUE
            AND provider = $1
            AND (abs(hashtext(id::text)::bigint) % $2::int4) = $3::int4
        "#,
            provider_filter as _,
            interval_hours,
            bucket
        )
        .fetch_all(&self.db)
        .await
    }

    async fn fetch_unused_link_ids(&self, days: i32) -> Result<Vec<uuid::Uuid>, Self::Error> {
        fetch_unused_link_ids(&self.db, days).await
    }

    async fn fetch_inactive_link_ids(&self, days: i32) -> Result<Vec<uuid::Uuid>, Self::Error> {
        fetch_inactive_link_ids(&self.db, days).await
    }
}

/// Fetch link IDs that were created > X days ago and have never viewed a thread
pub(crate) async fn fetch_unused_link_ids(
    pool: &Pool<Postgres>,
    delete_unused_after_days: i32,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
            SELECT
                l.id AS "link_id!"
            FROM
                public.email_links l
            LEFT JOIN
                public.email_user_history h ON l.id = h.link_id
            WHERE
                l.macro_id NOT LIKE '%@macro.com'
                AND l.created_at < NOW() - (make_interval(days => $1))
            GROUP BY
                l.id
            HAVING
                COUNT(h.link_id) = 0
            "#,
        delete_unused_after_days
    )
    .fetch_all(pool)
    .await
}

/// Fetch link IDs where the latest thread viewed was > Y days ago
pub(crate) async fn fetch_inactive_link_ids(
    pool: &Pool<Postgres>,
    delete_inactive_after_days: i32,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
            SELECT
                l.id AS "link_id!"
            FROM
                public.email_links l
            JOIN
                public.email_user_history h ON l.id = h.link_id
            WHERE
                l.macro_id NOT LIKE '%@macro.com'
            GROUP BY
                l.id
            HAVING
                MAX(h.updated_at) < NOW() - (make_interval(days => $1))
            "#,
        delete_inactive_after_days
    )
    .fetch_all(pool)
    .await
}
