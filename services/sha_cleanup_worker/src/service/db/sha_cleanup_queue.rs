use anyhow::Context;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

/// A SHA waiting for cleanup, with the time it was last released. Claiming
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

/// A queued SHA removed from the queue inside an open transaction, with
/// whether a `"BomPart"` row still references it. Commit once its object is
/// deleted, or straight away when referenced; dropping it rolls back and
/// leaves the SHA queued.
pub struct ShaClaim {
    transaction: Transaction<'static, Postgres>,
    pub referenced: bool,
}

impl ShaClaim {
    pub async fn commit(self) -> anyhow::Result<()> {
        self.transaction
            .commit()
            .await
            .context("unable to dequeue the cleaned up sha")
    }
}

/// Dequeues `queued` and checks its references in one statement, so a save
/// that committed a `"BomPart"` row before this point keeps the object. Returns
/// `None` when the SHA was released again since it was read: the next run
/// handles it.
#[tracing::instrument(skip(db), fields(sha = %queued.sha), err)]
pub(in crate::service::db) async fn claim_sha(
    db: &sqlx::Pool<sqlx::Postgres>,
    queued: &QueuedSha,
) -> anyhow::Result<Option<ShaClaim>> {
    let mut transaction = db.begin().await.context("unable to start the sha claim")?;
    let referenced = sqlx::query_scalar!(
        r#"
        DELETE FROM sha_cleanup_queue AS queue
        WHERE queue.sha = $1 AND queue.queued_at = $2
        RETURNING EXISTS (SELECT 1 FROM "BomPart" WHERE sha = queue.sha) AS "referenced!"
        "#,
        queued.sha,
        queued.queued_at
    )
    .fetch_optional(&mut *transaction)
    .await
    .context("unable to claim the queued sha")?;
    Ok(referenced.map(|referenced| ShaClaim {
        transaction,
        referenced,
    }))
}

#[cfg(test)]
mod test;
