use anyhow::Context;
use chrono::{DateTime, Utc};

/// A SHA waiting for cleanup, with the time it was last released. Dequeuing
/// matches both, so a release that lands while the worker runs stays queued.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedSha {
    pub sha: String,
    pub queued_at: DateTime<Utc>,
}

#[tracing::instrument(skip(db), err)]
pub(in crate::service::db) async fn queued_shas(
    db: &sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<Vec<QueuedSha>> {
    sqlx::query_as!(
        QueuedSha,
        r#"SELECT sha, queued_at FROM sha_cleanup_queue ORDER BY queued_at"#
    )
    .fetch_all(db)
    .await
    .context("unable to read the sha cleanup queue")
}

#[tracing::instrument(skip_all, fields(sha_count = shas.len()), err)]
pub(in crate::service::db) async fn dequeue_shas(
    db: &sqlx::Pool<sqlx::Postgres>,
    shas: Vec<QueuedSha>,
) -> anyhow::Result<()> {
    let (sha, queued_at): (Vec<String>, Vec<DateTime<Utc>>) = shas
        .into_iter()
        .map(|queued| (queued.sha, queued.queued_at))
        .unzip();
    sqlx::query!(
        r#"
        DELETE FROM sha_cleanup_queue AS queue
        USING UNNEST($1::text[], $2::timestamptz[]) AS done(sha, queued_at)
        WHERE queue.sha = done.sha AND queue.queued_at = done.queued_at
        "#,
        &sha,
        &queued_at
    )
    .execute(db)
    .await
    .context("unable to dequeue cleaned up shas")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;

    use super::*;

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_release_during_cleanup_stays_queued(pool: PgPool) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('done'), ('released-again')")
            .execute(&pool)
            .await?;
        let read = queued_shas(&pool).await?;
        assert_eq!(read.len(), 2);

        sqlx::query(
            "UPDATE sha_cleanup_queue SET queued_at = queued_at + interval '1 second' WHERE sha = 'released-again'",
        )
        .execute(&pool)
        .await?;
        dequeue_shas(&pool, read).await?;

        let remaining: Vec<String> = sqlx::query_scalar("SELECT sha FROM sha_cleanup_queue")
            .fetch_all(&pool)
            .await?;
        assert_eq!(remaining, vec!["released-again".to_string()]);
        Ok(())
    }
}
