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
mod tests {
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;

    use super::*;

    async fn insert_bom_part(pool: &PgPool, sha: &str) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
            VALUES ('a1111111-1111-1111-1111-111111111111', 'u@u.com', 'u@u.com', 's')
            "#,
        )
        .execute(pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
            VALUES ('macro|u@u.com', 'u@u.com', 's', 'a1111111-1111-1111-1111-111111111111')
            "#,
        )
        .execute(pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO "Document" (id, name, "fileType", owner, "createdAt", "updatedAt")
            VALUES ('docx-one', 'one', 'docx', 'macro|u@u.com', now(), now())
            "#,
        )
        .execute(pool)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO "DocumentBom" (id, "revisionName", "documentId", "createdAt", "updatedAt")
            VALUES (1, 'one', 'docx-one', now(), now())
            "#,
        )
        .execute(pool)
        .await?;
        sqlx::query(
            r#"INSERT INTO "BomPart" (id, sha, path, "documentBomId") VALUES ('part', $1, 'word/document.xml', 1)"#,
        )
        .bind(sha)
        .execute(pool)
        .await?;
        Ok(())
    }

    async fn remaining(pool: &PgPool) -> anyhow::Result<Vec<String>> {
        Ok(
            sqlx::query_scalar("SELECT sha FROM sha_cleanup_queue ORDER BY sha")
                .fetch_all(pool)
                .await?,
        )
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_part_reused_after_its_release_is_kept(pool: PgPool) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('orphan'), ('reused')")
            .execute(&pool)
            .await?;
        let read = queued_shas(&pool).await?;
        // A save reuses the part after the worker read the queue.
        insert_bom_part(&pool, "reused").await?;

        let mut referenced = Vec::new();
        for queued in &read {
            let claim = claim_sha(&pool, queued)
                .await?
                .expect("the sha is still queued");
            referenced.push((queued.sha.clone(), claim.referenced));
            claim.commit().await?;
        }

        assert_eq!(
            referenced,
            vec![("orphan".to_string(), false), ("reused".to_string(), true)]
        );
        assert_eq!(remaining(&pool).await?, Vec::<String>::new());
        Ok(())
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_failed_delete_leaves_the_sha_queued(pool: PgPool) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('orphan')")
            .execute(&pool)
            .await?;
        let read = queued_shas(&pool).await?;

        let claim = claim_sha(&pool, &read[0])
            .await?
            .expect("the sha is still queued");
        assert!(!claim.referenced);
        drop(claim);

        assert_eq!(remaining(&pool).await?, vec!["orphan".to_string()]);
        Ok(())
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_release_during_cleanup_stays_queued(pool: PgPool) -> anyhow::Result<()> {
        sqlx::query("INSERT INTO sha_cleanup_queue (sha) VALUES ('released-again')")
            .execute(&pool)
            .await?;
        let read = queued_shas(&pool).await?;

        sqlx::query(
            "UPDATE sha_cleanup_queue SET queued_at = queued_at + interval '1 second' WHERE sha = 'released-again'",
        )
        .execute(&pool)
        .await?;

        assert!(claim_sha(&pool, &read[0]).await?.is_none());
        assert_eq!(remaining(&pool).await?, vec!["released-again".to_string()]);
        Ok(())
    }
}
