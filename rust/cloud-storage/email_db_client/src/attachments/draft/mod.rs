use models_email::{db, service};
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};

/// Inserts a new draft attachment metadata record.
#[tracing::instrument(skip(executor, attachment), err)]
pub async fn insert_draft_attachment<'e, E>(
    executor: E,
    attachment: service::attachment::AttachmentDraft,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    let db_att: db::attachment::AttachmentDraft = attachment.into();

    sqlx::query!(
        r#"
            INSERT INTO email_attachments_drafts (
                id, draft_id, file_name, content_type, sha, size, s3_key
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        db_att.id,
        db_att.draft_id,
        db_att.file_name,
        db_att.content_type,
        db_att.sha,
        db_att.size,
        db_att.s3_key,
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Returns the sum of the size of all attachments for a given draft_id.
#[tracing::instrument(skip(pool), err)]
pub async fn get_total_attachments_size_by_draft_id(
    pool: &PgPool,
    draft_id: Uuid,
) -> anyhow::Result<i32> {
    let total_size: Option<i64> = sqlx::query_scalar!(
        r#"
                SELECT SUM(size)::BIGINT
                FROM email_attachments_drafts
                WHERE draft_id = $1
                "#,
        draft_id
    )
    .fetch_one(pool)
    .await?;

    Ok(total_size.unwrap_or(0) as i32)
}

/// Deletes a draft attachment record given the draft_id and attachment_id.
#[tracing::instrument(skip(executor), err)]
pub async fn delete_draft_attachment<'e, E>(
    executor: E,
    draft_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
                DELETE FROM email_attachments_drafts
                WHERE id = $1 AND draft_id = $2
                "#,
        attachment_id,
        draft_id
    )
    .execute(executor)
    .await?;

    Ok(result.rows_affected())
}
