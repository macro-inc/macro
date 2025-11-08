use anyhow::Result;
use model::annotations::{
    Anchor, Comment, Thread,
    create::{CreateCommentRequest, CreateCommentResponse},
};
use serde_json::Value;
use sqlx::{Pool, Postgres};

use crate::annotations::CommentError;

use super::{create_anchor::create_comment_anchor, get::get_comment_thread};

fn map_value_to_option(maybe_value: Option<Value>) -> Option<Value> {
    match maybe_value {
        Some(value) => {
            let empty = match &value {
                Value::Null => true,
                Value::String(s) => s.is_empty(),
                Value::Array(arr) => arr.is_empty(),
                Value::Object(map) => map.is_empty(),
                _ => false,
            };

            match empty {
                true => None,
                false => Some(value),
            }
        }
        None => None,
    }
}

pub async fn create_document_comment(
    db: &Pool<Postgres>,
    document_id: &str,
    owner: &str,
    req: CreateCommentRequest,
) -> Result<CreateCommentResponse> {
    let mut transaction = db.begin().await?;

    let thread = match req.thread_id {
        Some(thread_id) => match map_value_to_option(req.thread_metadata) {
            Some(thread_metadata) => sqlx::query_as!(
                Thread,
                r#"
                UPDATE "Thread" t
                SET "updatedAt" = NOW(), "metadata" = $3
                WHERE t."documentId" = $1 AND t."deletedAt" IS NULL AND t.id = $2
                RETURNING
                    t.id as thread_id, 
                    t.resolved, 
                    t."documentId" as document_id, 
                    t."createdAt"::timestamptz as created_at, 
                    t."updatedAt"::timestamptz as updated_at, 
                    t."deletedAt"::timestamptz as deleted_at, 
                    t.metadata, 
                    t.owner
                "#,
                document_id,
                thread_id,
                thread_metadata,
            )
            .fetch_one(transaction.as_mut())
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::ThreadNotFound),
                e => anyhow::anyhow!(e),
            })?,
            None => sqlx::query_as!(
                Thread,
                r#"
                UPDATE "Thread" t
                SET "updatedAt" = NOW()
                WHERE t."documentId" = $1 AND t."deletedAt" IS NULL AND t.id = $2
                RETURNING
                    t.id as thread_id, 
                    t.resolved, 
                    t."documentId" as document_id, 
                    t."createdAt"::timestamptz as created_at, 
                    t."updatedAt"::timestamptz as updated_at, 
                    t."deletedAt"::timestamptz as deleted_at, 
                    t.metadata, 
                    t.owner
                "#,
                document_id,
                thread_id,
            )
            .fetch_one(transaction.as_mut())
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => anyhow::anyhow!(CommentError::ThreadNotFound),
                e => anyhow::anyhow!(e),
            })?,
        },
        None => {
            sqlx::query_as!(
                Thread,
                r#"
                INSERT INTO "Thread" AS t 
                ("owner", "documentId", "createdAt", "updatedAt", "metadata")
                VALUES ($1, $2, NOW(), NOW(), $3)
                RETURNING
                    t.id as thread_id, 
                    t.resolved, 
                    t."documentId" as document_id, 
                    t."createdAt"::timestamptz as created_at, 
                    t."updatedAt"::timestamptz as updated_at, 
                    t."deletedAt"::timestamptz as deleted_at, 
                    t.metadata, 
                    t.owner
                "#,
                owner,
                document_id,
                req.thread_metadata,
            )
            .fetch_one(transaction.as_mut())
            .await?
        }
    };

    let mut anchor: Option<Anchor> = None;
    if let Some(anchor_req) = req.anchor {
        let res = create_comment_anchor(
            &mut transaction,
            owner,
            document_id,
            anchor_req,
            thread.thread_id,
        )
        .await?;
        anchor = Some(res);
    };

    let _new_comment = sqlx::query_as!(
        Comment,
        r#"
        INSERT INTO "Comment" AS c 
        ("threadId", "owner", "text", "metadata")
        VALUES ($1, $2, $3, $4)
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
        thread.thread_id,
        owner,
        req.text,
        req.metadata,
    )
    .fetch_one(transaction.as_mut())
    .await?;

    transaction.commit().await?;

    let comment_thread = get_comment_thread(db, thread.thread_id).await?;

    match comment_thread {
        Some(comment_thread) => Ok(CreateCommentResponse {
            document_id: document_id.to_string(),
            comment_thread,
            anchor,
        }),
        None => anyhow::bail!("Comment thread not found after creation"),
    }
}

#[cfg(test)]
mod tests {

    use crate::annotations::get::get_document_comments;

    use super::*;
    use serde_json::json;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_document_comment(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";
        let req = CreateCommentRequest {
            text: "This is a test comment".to_string(),
            thread_id: None,
            thread_metadata: Some(json!({"test": "test"})),
            anchor: None,
            metadata: None,
        };

        let CreateCommentResponse { comment_thread, .. } =
            create_document_comment(&pool, document_id, owner, req).await?;

        // Verify the thread and comment were created
        assert_eq!(comment_thread.comments.len(), 1);
        assert_eq!(
            comment_thread.thread.metadata,
            Some(json!({"test": "test"}))
        );
        let comment = &comment_thread.comments[0];
        assert_eq!(comment.text, "This is a test comment");
        assert_eq!(comment.owner, "macro|user@user.com".to_string());
        assert_eq!(comment.metadata, None);

        // Fetch the comments to verify they were inserted correctly
        let fetched_threads = get_document_comments(&pool, "document-with-comments").await?;
        assert!(
            fetched_threads
                .iter()
                .any(|t| t.thread.thread_id == comment_thread.thread.thread_id)
        );

        Ok(())
    }

    #[sqlx::test(fixtures(
        path = "../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    ))]
    async fn test_create_document_comment_with_existing_thread(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let document_id = "document-with-comments";
        let owner = "macro|user@user.com";
        let req = CreateCommentRequest {
            text: "This is another test comment".to_string(),
            thread_id: Some(1001),
            thread_metadata: None,
            anchor: None,
            metadata: None,
        };

        let CreateCommentResponse { comment_thread, .. } =
            create_document_comment(&pool, document_id, owner, req).await?;

        // Verify the comment was added to the existing thread
        assert_eq!(comment_thread.thread.thread_id, 1001);
        assert!(
            comment_thread
                .comments
                .iter()
                .any(|c| c.text == "This is another test comment")
        );

        Ok(())
    }

    #[test]
    fn test_map_value_to_option() {
        // null
        assert_eq!(map_value_to_option(Some(Value::Null)), None);

        // empty string
        assert_eq!(map_value_to_option(Some(json!(""))), None);

        // non-empty string
        assert_eq!(
            map_value_to_option(Some(json!("hello"))),
            Some(json!("hello"))
        );

        // empty array
        assert_eq!(map_value_to_option(Some(json!([]))), None);

        // non-empty array
        assert_eq!(
            map_value_to_option(Some(json!([1, 2, 3]))),
            Some(json!([1, 2, 3]))
        );

        // empty object
        assert_eq!(map_value_to_option(Some(json!({}))), None);

        // non-empty object
        assert_eq!(
            map_value_to_option(Some(json!({"a": 1}))),
            Some(json!({"a": 1}))
        );

        // number
        assert_eq!(map_value_to_option(Some(json!(42))), Some(json!(42)));

        // bool
        assert_eq!(map_value_to_option(Some(json!(true))), Some(json!(true)));

        // None
        assert_eq!(map_value_to_option(None), None);
    }
}
