use models_email::{db, service};
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};

#[cfg(test)]
mod test;

/// Inserts a new draft attachment metadata record.
#[tracing::instrument(skip(executor, attachment), err)]
pub async fn insert_draft_attachment<'e, E>(
    executor: E,
    link_id: Uuid,
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
            -- if the message belongs to a different link_id, nothing will be returned from this
            -- and thus nothing will be inserted
                SELECT $1, $2, $3, $4, $5, $6, $7
                FROM email_messages m
                WHERE m.id = $2 AND m.link_id = $8
            "#,
        db_att.id,
        db_att.draft_id,
        db_att.file_name,
        db_att.content_type,
        db_att.sha,
        db_att.size,
        db_att.s3_key,
        link_id
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Returns the sum of the size of all attachments for a given draft_id.
#[tracing::instrument(skip(pool), err)]
pub async fn get_total_attachments_size_by_draft_id(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
) -> anyhow::Result<i32> {
    let total_size: Option<i64> = sqlx::query_scalar!(
        r#"
                SELECT SUM(ead.size)::BIGINT
                FROM email_attachments_drafts ead
                JOIN email_messages m ON ead.draft_id = m.id
                WHERE ead.draft_id = $1 AND m.link_id = $2
                "#,
        draft_id,
        link_id
    )
    .fetch_one(pool)
    .await?;

    Ok(total_size.unwrap_or(0) as i32)
}

/// Deletes a draft attachment record given the draft_id and attachment_id.
#[tracing::instrument(skip(executor), err)]
pub async fn delete_draft_attachment<'e, E>(
    executor: E,
    link_id: Uuid,
    draft_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
                DELETE FROM email_attachments_drafts ead
                USING email_messages m
                WHERE ead.draft_id = m.id
                AND ead.id = $1 AND ead.draft_id = $2 AND m.link_id = $3
                "#,
        attachment_id,
        draft_id,
        link_id
    )
    .execute(executor)
    .await?;

    Ok(result.rows_affected())
}

/// Fetches all draft attachments for a given draft_id.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_draft_attachments_by_draft_id(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
) -> anyhow::Result<Vec<service::attachment::AttachmentDraft>> {
    let db_attachments = sqlx::query_as!(
        db::attachment::AttachmentDraft,
        r#"
            SELECT ead.id, ead.draft_id, ead.file_name, ead.content_type, ead.sha, ead.size, ead.s3_key
            FROM email_attachments_drafts ead
            JOIN email_messages m ON ead.draft_id = m.id
            WHERE ead.draft_id = $1 AND m.link_id = $2
            ORDER BY ead.file_name ASC
            "#,
            draft_id,
            link_id
    )
    .fetch_all(pool)
    .await?;

    let service_attachments = db_attachments
        .into_iter()
        .map(service::attachment::AttachmentDraft::from)
        .collect();

    Ok(service_attachments)
}
