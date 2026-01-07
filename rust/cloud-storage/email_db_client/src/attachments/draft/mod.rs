use models_email::{db, service};
use sqlx::{Executor, Postgres};

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
