use anyhow::Result;
use sqlx::{Postgres, Transaction};

use crate::annotations::CommentError;

pub async fn delete_document_thread(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: i64,
) -> Result<()> {
    let _deleted_at = sqlx::query!(
        r#"
            UPDATE "Thread"
            SET "deletedAt" = NOW()
            WHERE id = $1 and "deletedAt" IS NULL
            RETURNING "deletedAt"
            "#,
        thread_id
    )
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::ThreadNotFound),
        e => anyhow::anyhow!(e),
    })?;

    // Mark all the comments as deleted
    sqlx::query!(
        r#"
            UPDATE "Comment"
            SET "deletedAt" = NOW()
            WHERE "threadId" = $1
            "#,
        thread_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[cfg(test)]
mod delete_thread_tests {
    use super::*;
    use sqlx::PgPool;

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_delete_thread_success(pool: PgPool) {
        let thread_id = 1001;

        let mut transaction = pool.begin().await.unwrap();
        let result = delete_document_thread(&mut transaction, thread_id).await;
        transaction.commit().await.unwrap();

        assert!(result.is_ok(), "Expected success but got {:?}", result);

        // Verify the thread is marked as deleted
        let deleted_thread = sqlx::query_scalar!(
            r#"
            SELECT "deletedAt" FROM "Thread"
            WHERE id = $1
            "#,
            thread_id
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(
            deleted_thread.is_some(),
            "Thread should have been marked as deleted"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_delete_thread_not_found(pool: PgPool) {
        let thread_id = 6243; // does not exist

        let mut transaction = pool.begin().await.unwrap();
        let result = delete_document_thread(&mut transaction, thread_id).await;
        transaction.commit().await.unwrap();

        assert!(result.is_err(), "Expected failure for non-existent thread");
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::ThreadNotFound)
            ),
            "Expected ThreadNotFound error"
        );
    }
}
