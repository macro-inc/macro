use anyhow::{Result, bail};
use model::annotations::{
    AnchorId, PdfAnchorId,
    delete::{DeleteAnchorInfo, DeleteCommentRequest, DeleteCommentResponse, DeleteThreadInfo},
};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::annotations::{
    delete_anchor::remove_document_anchor, delete_thread::delete_document_thread,
};

use super::{AnchorTableName, CommentError};

pub async fn delete_document_comment(
    db: &Pool<Postgres>,
    comment_id: i64,
    user_id: &str,
    req: DeleteCommentRequest,
) -> Result<DeleteCommentResponse> {
    let (comment_owner, thread_id, document_owner, document_id, anchor_id, anchor_table_name) = sqlx::query!(
        r#"
        SELECT c.owner, t.id as thread_id, d.owner as document_owner, d.id as document_id, ta."anchorId" as "anchor_id?", ta."anchorTableName" as "anchor_table_name?: AnchorTableName"
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        JOIN "Document" d ON t."documentId" = d.id
        LEFT JOIN "ThreadAnchor" ta ON ta."threadId" = t.id
        WHERE c.id = $1 AND c."deletedAt" IS NULL
        "#,
        comment_id
    )
    .map(|row| (row.owner, row.thread_id, row.document_owner, row.document_id, row.anchor_id, row.anchor_table_name))
    .fetch_one(db)
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::CommentNotFound),
        e => anyhow::anyhow!(e),
    })?;

    if comment_owner != user_id && document_owner != user_id {
        bail!(CommentError::InvalidPermissions);
    }

    let mut transaction = db.begin().await?;

    // Check if the deleted comment is the root comment
    // NOTE: null values sort as if larger than non-null values
    // this lets us prioritize the deprecated "order" field when not-null
    let root_comment_id = sqlx::query!(
        r#"
        SELECT c.id as comment_id
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        WHERE t.id = $1 AND c."deletedAt" IS NULL
        ORDER BY c."order", c."createdAt" ASC
        LIMIT 1
        "#,
        thread_id
    )
    .map(|row| row.comment_id)
    .fetch_one(db)
    .await?;

    // Mark the comment as deleted
    sqlx::query!(
        r#"
        UPDATE "Comment"
        SET "deletedAt" = NOW()
        WHERE "id" = $1 AND "deletedAt" IS NULL
        "#,
        comment_id
    )
    .execute(transaction.as_mut())
    .await?;

    let mut deleted_thread_info = DeleteThreadInfo {
        thread_id,
        deleted: false,
    };

    let mut deleted_anchor_info =
        anchor_id
            .zip(anchor_table_name.clone())
            .map(|(anchor_id, anchor_table_name)| DeleteAnchorInfo {
                anchor_info: get_anchor_id(anchor_id, &anchor_table_name),
                deleted: false,
            });

    // Mark the thread as deleted if the root comment is deleted
    if root_comment_id == comment_id {
        tracing::trace!(
            "deleted comment {} is the root comment, marking thread as deleted: {}",
            comment_id,
            thread_id
        );

        delete_document_thread(&mut transaction, thread_id).await?;
        deleted_thread_info.deleted = true;

        if let Some((anchor_id, anchor_table_name)) = anchor_id.zip(anchor_table_name) {
            let anchor_deleted = remove_document_anchor(
                &mut transaction,
                user_id,
                anchor_id,
                anchor_table_name,
                req.remove_anchor_thread_only,
            )
            .await?;
            deleted_anchor_info = deleted_anchor_info.map(|mut i| {
                i.deleted = anchor_deleted;
                i
            });
        }
    }

    transaction.commit().await?;

    Ok(DeleteCommentResponse {
        document_id,
        comment_id,
        thread: deleted_thread_info,
        anchor: deleted_anchor_info,
    })
}

fn get_anchor_id(anchor_id: Uuid, anchor_table_name: &AnchorTableName) -> AnchorId {
    match anchor_table_name {
        AnchorTableName::PdfPlaceableCommentAnchor => {
            AnchorId::Pdf(PdfAnchorId::FreeComment(anchor_id))
        }
        AnchorTableName::PdfHighlightAnchor => AnchorId::Pdf(PdfAnchorId::Highlight(anchor_id)),
    }
}

#[cfg(test)]
mod delete_comment_tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_successful_comment_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let comment_id = 10001; // Comment in thread 1001
        let owner = "macro|user@user.com";

        delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default()).await?;

        let deleted_comment = sqlx::query!(
            r#"
            SELECT "deletedAt" FROM "Comment"
            WHERE id = $1
            "#,
            comment_id
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            deleted_comment.deletedAt.is_some(),
            "Comment should be marked as deleted"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_cannot_delete_deleted_comment(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let comment_id = 10001; // Comment in thread 1001
        let owner = "macro|user@user.com";

        delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default()).await?;

        let deleted_comment = sqlx::query!(
            r#"
            SELECT "deletedAt" FROM "Comment"
            WHERE id = $1
            "#,
            comment_id
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            deleted_comment.deletedAt.is_some(),
            "Comment should be marked as deleted"
        );

        let result =
            delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default())
                .await;
        assert_eq!(result.unwrap_err().to_string(), "Comment not found");

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_unauthorized_comment_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let comment_id = 10001; // Comment owned by macro|user@user.com
        let unauthorized_user = "macro|user2@user.com"; // Not the owner

        let result = delete_document_comment(
            &pool,
            comment_id,
            unauthorized_user,
            DeleteCommentRequest::default(),
        )
        .await;

        assert!(
            result.is_err(),
            "Unauthorized user should not be able to delete the comment"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_root_comment_deletion_deletes_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let comment_id = 10001; // Root comment in thread 1001
        let owner = "macro|user@user.com";

        let delete_response =
            delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default())
                .await?;
        assert_eq!(delete_response.thread.deleted, true);
        assert_eq!(
            delete_response.anchor.as_ref().map(|a| a.deleted),
            Some(true)
        );

        let deleted_thread = sqlx::query!(
            r#"
            SELECT "deletedAt" FROM "Thread"
            WHERE id = 1001
            "#,
        )
        .fetch_one(&pool)
        .await?;

        let deleted_comments = sqlx::query!(
            r#"
            SELECT COUNT(*) as count FROM "Comment"
            WHERE "threadId" = 1001 AND "deletedAt" IS NULL
            "#,
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            deleted_thread.deletedAt.is_some(),
            "Thread should be marked as deleted when root comment is deleted"
        );

        assert_eq!(
            deleted_comments.count.unwrap_or(0),
            0,
            "All comments in the thread should be marked as deleted"
        );

        let anchor_uuid = match delete_response.anchor.unwrap().anchor_info {
            AnchorId::Pdf(PdfAnchorId::FreeComment(anchor_uuid)) => anchor_uuid,
            _ => panic!("Unexpected anchor type"),
        };

        let thread_anchor_exists = sqlx::query!(
            r#"
            SELECT (1) as exists
            FROM "ThreadAnchor"
            WHERE "threadId" = $1 AND "anchorId" = $2
    "#,
            delete_response.thread.thread_id,
            anchor_uuid
        )
        .fetch_optional(&pool)
        .await?;
        assert!(thread_anchor_exists.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_non_root_comment_deletion_does_not_delete_thread(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let comment_id = 10002; // Non-root comment in thread 1001
        let owner = "macro|user@user.com";

        let delete_response =
            delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default())
                .await?;
        assert_eq!(delete_response.thread.deleted, false);

        let deleted_thread = sqlx::query!(
            r#"
            SELECT "deletedAt" FROM "Thread"
            WHERE id = 1001
            "#,
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            deleted_thread.deletedAt.is_none(),
            "Thread should not be marked as deleted when a non-root comment is deleted"
        );

        let remaining_comments = sqlx::query!(
            r#"
            SELECT COUNT(*) as count FROM "Comment"
            WHERE "threadId" = 1001 AND "deletedAt" IS NULL
            "#,
        )
        .fetch_one(&pool)
        .await?;

        assert!(
            remaining_comments.count.unwrap_or(0) > 0,
            "Non-root comment deletion should not delete all comments in the thread"
        );

        let anchor_uuid = match delete_response.anchor.unwrap().anchor_info {
            AnchorId::Pdf(PdfAnchorId::FreeComment(anchor_uuid)) => anchor_uuid,
            _ => panic!("Unexpected anchor type"),
        };

        sqlx::query!(
            r#"
            SELECT (1) as exists
            FROM "ThreadAnchor"
            WHERE "threadId" = $1 AND "anchorId" = $2
            "#,
            delete_response.thread.thread_id,
            anchor_uuid
        )
        .fetch_one(&pool)
        .await?;

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_no_thread_anchor_comment_deletes_comment(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let comment_id = 10008; // root comment in thread 1005
        let owner = "macro|user@user.com";

        let delete_response =
            delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default())
                .await?;
        assert_eq!(delete_response.thread.deleted, true);
        assert_eq!(delete_response.anchor.is_none(), true);

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_document_owner_can_delete_unowned_comment(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let comment_id = 10007;
        let document_owner = "macro|user@user.com";

        delete_document_comment(
            &pool,
            comment_id,
            document_owner,
            DeleteCommentRequest::default(),
        )
        .await?;

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_non_document_owner_can_delete_owned_comment(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let comment_id = 10007;
        let owner = "macro|user2@user.com";

        delete_document_comment(&pool, comment_id, owner, DeleteCommentRequest::default()).await?;

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_non_document_owner_cannot_delete_unowned_comment(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let comment_id = 10007;
        let non_owner = "macro|user3@user.com";

        let result = delete_document_comment(
            &pool,
            comment_id,
            non_owner,
            DeleteCommentRequest::default(),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "Invalid permissions");

        Ok(())
    }
}
