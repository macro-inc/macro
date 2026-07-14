use anyhow::{Result, bail};
use model::annotations::{
    AnchorId, PdfAnchorId,
    delete::{
        DeleteUnthreadedAnchorRequest, DeleteUnthreadedAnchorResponse,
        DeleteUnthreadedPdfAnchorRequest,
    },
};
use sqlx::{Pool, Postgres, Transaction, types::Uuid};

use super::{AnchorTableName, CommentError, delete_thread::delete_document_thread};

pub async fn delete_document_anchor(
    db: &Pool<Postgres>,
    user_id: &str,
    req: DeleteUnthreadedAnchorRequest,
) -> Result<DeleteUnthreadedAnchorResponse> {
    let thread_id: Option<i64>;
    let document_id: String;
    let mut transaction = db.begin().await?;

    let anchor_info: AnchorId;
    match req {
        DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid)) => {
            (thread_id, document_id) =
                delete_pdf_highlight_anchor(&mut transaction, user_id, uuid, false).await?;
            anchor_info = AnchorId::Pdf(PdfAnchorId::Highlight(uuid));
        }
    }

    if let Some(thread_id) = thread_id {
        delete_document_thread(&mut transaction, thread_id).await?;
    }

    transaction.commit().await?;

    Ok(DeleteUnthreadedAnchorResponse {
        document_id,
        anchor_info,
        thread_id,
    })
}

async fn delete_pdf_highlight_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    uuid: Uuid,
    remove_anchor_thread_only: bool,
) -> Result<(Option<i64>, String)> {
    // TODO: add db constraint for thread owner == threaded anchor owner
    let (anchor_owner, thread_id, document_owner, document_id) = sqlx::query!(
        r#"
        SELECT a.owner, a."threadId" as thread_id, d.owner as document_owner, d.id as document_id
        FROM "PdfHighlightAnchor" a
        JOIN "Document" d ON a."documentId" = d.id
        WHERE a.uuid = $1 AND a."deletedAt" IS NULL
        "#,
        uuid
    )
    .map(|row| {
        (
            row.owner,
            row.thread_id,
            row.document_owner,
            row.document_id,
        )
    })
    .fetch_one(transaction.as_mut())
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::AnchorNotFound),
        e => anyhow::anyhow!(e),
    })?;

    if anchor_owner != user_id && document_owner != user_id {
        bail!(CommentError::InvalidPermissions);
    }

    if !remove_anchor_thread_only {
        // Mark the anchor as deleted
        sqlx::query!(
            r#"
        UPDATE "PdfHighlightAnchor"
        SET "deletedAt" = NOW()
        WHERE uuid = $1 AND "deletedAt" IS NULL
        "#,
            uuid
        )
        .execute(transaction.as_mut())
        .await?;
    } else {
        // Detach the thread from the anchor
        sqlx::query!(
            r#"
            UPDATE "PdfHighlightAnchor"
            SET "threadId" = NULL
            WHERE uuid = $1 AND "deletedAt" IS NULL
            "#,
            uuid
        )
        .execute(transaction.as_mut())
        .await?;
    }

    Ok((thread_id, document_id))
}

// returns true if the anchor was deleted
pub async fn remove_document_anchor(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    anchor_id: Uuid,
    anchor_table_name: AnchorTableName,
    remove_anchor_thread_only: Option<bool>,
) -> Result<bool> {
    let should_remove_anchor_thread_only = remove_anchor_thread_only.unwrap_or(false);

    match anchor_table_name {
        AnchorTableName::PdfPlaceableCommentAnchor => {
            if should_remove_anchor_thread_only {
                bail!(CommentError::NotAllowed(
                    "PDF free comment anchors cannot be detached from a thread".to_string(),
                ))
            }
        } // cannot exist without a thread
        AnchorTableName::PdfHighlightAnchor => {
            delete_pdf_highlight_anchor(
                transaction,
                user_id,
                anchor_id,
                should_remove_anchor_thread_only,
            )
            .await?;
        }
    }

    let anchor_deleted = !should_remove_anchor_thread_only;
    Ok(anchor_deleted)
}

#[cfg(test)]
mod delete_anchor_tests {
    use super::*;
    use crate::annotations::CommentError;
    use sqlx::{PgPool, types::Uuid};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_delete_unthreaded_highlight_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("33333333-3333-3333-3333-333333333333").unwrap(); // Threaded highlight (linked to thread 1001)

        let request =
            DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid));

        let result = delete_document_anchor(&pool, user_id, request).await;

        assert!(result.is_ok(), "Expected success but got {:?}", result);

        // Verify the anchor is marked as deleted
        let deleted_anchor = sqlx::query_scalar!(
            r#"
            SELECT "deletedAt" FROM "PdfHighlightAnchor"
            WHERE uuid = $1
            "#,
            uuid
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(
            deleted_anchor.is_some(),
            "Anchor should have been marked as deleted"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_remove_unthreaded_highlight_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("33333333-3333-3333-3333-333333333333").unwrap(); // Threaded highlight (linked to thread 1001)

        let mut transaction = pool.begin().await.unwrap();
        let result = remove_document_anchor(
            &mut transaction,
            user_id,
            uuid,
            AnchorTableName::PdfHighlightAnchor,
            Some(false),
        )
        .await;
        transaction.commit().await.unwrap();

        assert!(result.is_ok(), "Expected success but got {:?}", result);
        assert_eq!(
            result.unwrap(),
            true,
            "Expect function to return deleted true"
        );

        let deleted_anchor = sqlx::query!(
            r#"
            SELECT "deletedAt", "threadId"
            FROM "PdfHighlightAnchor"
            WHERE uuid = $1
            "#,
            uuid
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(deleted_anchor.deletedAt.is_some());
        assert_eq!(deleted_anchor.threadId, None);

        let thread_anchor = sqlx::query!(
            r#"
            SELECT (1) as exists
            FROM "ThreadAnchor"
            WHERE "anchorId" = $1
            "#,
            uuid
        )
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert!(thread_anchor.is_none());
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_detach_unthreaded_highlight_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("33333333-3333-3333-3333-333333333333").unwrap(); // Threaded highlight (linked to thread 1001)

        let mut transaction = pool.begin().await.unwrap();
        let result = remove_document_anchor(
            &mut transaction,
            user_id,
            uuid,
            AnchorTableName::PdfHighlightAnchor,
            Some(true),
        )
        .await;
        transaction.commit().await.unwrap();

        assert!(result.is_ok(), "Expected success but got {:?}", result);
        assert_eq!(result.unwrap(), false);

        let deleted_anchor = sqlx::query!(
            r#"
            SELECT "deletedAt", "threadId"
            FROM "PdfHighlightAnchor"
            WHERE uuid = $1
            "#,
            uuid
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(deleted_anchor.deletedAt.is_none());
        assert_eq!(deleted_anchor.threadId, None);

        let thread_anchor = sqlx::query!(
            r#"
            SELECT (1) as exists
            FROM "ThreadAnchor"
            WHERE "anchorId" = $1
            "#,
            uuid
        )
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert!(thread_anchor.is_none());
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_detach_threaded_highlight_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("33333333-3333-3333-3333-333333333333").unwrap(); // Threaded highlight (linked to thread 1001)
        let thread_id = 1005;

        // attach the thread to the anchor
        sqlx::query!(
            r#"
            UPDATE "PdfHighlightAnchor"
            SET "threadId" = $1
            WHERE uuid = $2
            "#,
            thread_id,
            uuid
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query!(
            r#"
            INSERT INTO "ThreadAnchor" ("threadId", "anchorId", "anchorTableName")
            VALUES ($1, $2, $3::"anchor_table_name")
            "#,
            thread_id,
            uuid,
            AnchorTableName::PdfHighlightAnchor as _
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut transaction = pool.begin().await.unwrap();
        let result = remove_document_anchor(
            &mut transaction,
            user_id,
            uuid,
            AnchorTableName::PdfHighlightAnchor,
            Some(true),
        )
        .await;
        transaction.commit().await.unwrap();

        assert!(result.is_ok(), "Expected success but got {:?}", result);
        assert_eq!(result.unwrap(), false);

        let deleted_anchor = sqlx::query!(
            r#"
            SELECT "deletedAt", "threadId"
            FROM "PdfHighlightAnchor"
            WHERE uuid = $1
            "#,
            uuid
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(deleted_anchor.deletedAt.is_none());
        assert_eq!(deleted_anchor.threadId, None);

        let thread_anchor = sqlx::query!(
            r#"
            SELECT (1) as exists
            FROM "ThreadAnchor"
            WHERE "anchorId" = $1
            "#,
            uuid
        )
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert!(thread_anchor.is_some());
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_delete_threaded_highlight_anchor_success(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::try_parse("11111111-1111-1111-1111-111111111111").unwrap(); // Threaded highlight (linked to thread 1001)

        let request =
            DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid));

        let result = delete_document_anchor(&pool, user_id, request).await;
        assert!(result.is_ok(), "Expected success but got {:?}", result);
        let anchor = result.unwrap();
        assert_eq!(anchor.thread_id, Some(1001));
        let ret_uuid: Uuid = anchor.anchor_info.into();
        assert_eq!(ret_uuid.to_string(), "11111111-1111-1111-1111-111111111111");
        assert_eq!(anchor.document_id, "document-with-comments");

        // Verify the anchor is marked as deleted
        let deleted_anchor = sqlx::query_scalar!(
            r#"
            SELECT "deletedAt" FROM "PdfHighlightAnchor"
            WHERE uuid = $1
            "#,
            uuid
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(
            deleted_anchor.is_some(),
            "Anchor should have been marked as deleted"
        );

        // Verify the thread is also marked as deleted
        let deleted_thread = sqlx::query_scalar!(
            r#"
            SELECT "deletedAt" FROM "Thread"
            WHERE id = 1001
            "#,
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
    async fn test_delete_anchor_not_found(pool: PgPool) {
        let user_id = "macro|user@user.com";
        let uuid = Uuid::new_v4(); // Random UUID

        let request =
            DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid));

        let result = delete_document_anchor(&pool, user_id, request).await;

        assert!(result.is_err(), "Expected failure for non-existent anchor");
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::AnchorNotFound)
            ),
            "Expected AnchorNotFound error"
        );
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_delete_anchor_invalid_permissions(pool: PgPool) {
        let unauthorized_user = "macro|unauthorized_user@user.com"; // User not allowed to delete this anchor
        let uuid = Uuid::try_parse("11111111-1111-1111-1111-111111111111").unwrap(); // Threaded highlight (linked to thread 1001)

        let request =
            DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(uuid));

        let result = delete_document_anchor(&pool, unauthorized_user, request).await;

        assert!(
            result.is_err(),
            "Expected failure due to insufficient permissions"
        );
        assert!(
            matches!(
                result.unwrap_err().downcast_ref::<CommentError>(),
                Some(CommentError::InvalidPermissions)
            ),
            "Expected InvalidPermissions error"
        );
    }
}
