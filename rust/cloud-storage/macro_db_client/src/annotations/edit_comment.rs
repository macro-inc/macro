use anyhow::{Result, bail};
use model::annotations::{
    Comment,
    edit::{EditCommentRequest, EditCommentResponse},
};
use sqlx::{Pool, Postgres};

use crate::annotations::CommentError;

pub async fn edit_document_comment(
    db: &Pool<Postgres>,
    comment_id: i64,
    user_id: &str,
    req: EditCommentRequest,
) -> Result<EditCommentResponse> {
    let (comment_owner, document_id) = sqlx::query!(
        r#"
        SELECT c.owner, t."documentId" as document_id
        FROM "Comment" c
        JOIN "Thread" t ON c."threadId" = t.id
        WHERE c.id = $1 and c."deletedAt" IS NULL AND t."deletedAt" IS NULL
        "#,
        comment_id
    )
    .map(|row| (row.owner, row.document_id))
    .fetch_one(db)
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::CommentNotFound),
        e => anyhow::anyhow!(e),
    })?;

    if comment_owner != user_id {
        bail!(CommentError::InvalidPermissions);
    }

    let comment = sqlx::query_as!(
        Comment,
        r#"
        UPDATE "Comment" c
        SET "text" = $1, "metadata" = $2, "updatedAt" = NOW()
        WHERE "id" = $3 AND "deletedAt" IS NULL
        RETURNING 
            c.id as comment_id, 
            c."threadId" as thread_id, 
            c.owner, 
            c.sender, 
            c.text, 
            c.metadata, 
            c."createdAt"::timestamptz as created_at, 
            c."updatedAt"::timestamptz as updated_at, 
            c."deletedAt"::timestamptz as deleted_at, 
            c.order
        "#,
        req.text,
        req.metadata,
        comment_id
    )
    .fetch_one(db)
    .await?;

    Ok(EditCommentResponse {
        document_id,
        comment,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_document_comment(pool: Pool<Postgres>) {
        let comment_id = 10001;
        let owner = "macro|user@user.com";
        let req = EditCommentRequest {
            text: Some("Updated comment text".to_string()),
            metadata: None,
        };

        let result = edit_document_comment(&pool, comment_id, owner, req).await;
        let EditCommentResponse {
            comment,
            document_id,
        } = result.unwrap();
        assert_eq!(comment.text, "Updated comment text");
        assert_eq!(document_id, "document-with-comments");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_edit_no_row(pool: Pool<Postgres>) {
        let comment_id = 6543024; // should not exist
        let owner = "macro|user@user.com";
        let req = EditCommentRequest {
            text: Some("Updated comment text".to_string()),
            metadata: None,
        };

        let result = edit_document_comment(&pool, comment_id, owner, req).await;
        assert_eq!(result.unwrap_err().to_string(), "Comment not found");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_document_owner_cannot_edit_unowned_comment(pool: Pool<Postgres>) {
        let comment_id = 10007;
        let document_owner = "macro|user@user.com";
        let req = EditCommentRequest {
            text: Some("Updated comment text".to_string()),
            metadata: None,
        };

        let result = edit_document_comment(&pool, comment_id, document_owner, req).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "Invalid permissions");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_non_document_owner_can_delete_owned_comment(pool: Pool<Postgres>) {
        let comment_id = 10007;
        let owner = "macro|user2@user.com";
        let req = EditCommentRequest {
            text: Some("Updated comment text".to_string()),
            metadata: None,
        };

        let result = edit_document_comment(&pool, comment_id, owner, req).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap().comment.text, "Updated comment text");
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_non_document_owner_cannot_delete_unowned_comment(pool: Pool<Postgres>) {
        let comment_id = 10007;
        let non_owner = "macro|user3@user.com";
        let req = EditCommentRequest {
            text: Some("Updated comment text".to_string()),
            metadata: None,
        };

        let result = edit_document_comment(&pool, comment_id, non_owner, req).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "Invalid permissions");
    }
}
