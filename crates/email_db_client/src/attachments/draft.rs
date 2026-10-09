use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// Inserts a new draft attachment metadata record.
#[tracing::instrument(skip(pool, attachment), err)]
pub async fn insert_draft_attachment(
    pool: &PgPool,
    link_id: Uuid,
    attachment: service::attachment::AttachmentDraft,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    anyhow::ensure!(
        super::mutation::lock_editable_attachment_message(
            &mut tx,
            link_id,
            attachment.draft_id,
            false
        )
        .await?,
        "draft is no longer editable"
    );
    let db_att: db::attachment::AttachmentDraft = attachment.into();

    let inserted = sqlx::query!(
        r#"
            WITH editable AS (
                SELECT id FROM email_messages
                WHERE id = $2 AND link_id = $8 AND is_draft AND NOT is_sent
                FOR UPDATE
            )
            INSERT INTO email_attachments_drafts (
                id, draft_id, file_name, content_type, sha, size, s3_key
            )
            -- if the message belongs to a different link_id, nothing will be returned from this
            -- and thus nothing will be inserted
                SELECT $1, $2, $3, $4, $5, $6, $7
                FROM editable
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
    .execute(&mut *tx)
    .await?;
    anyhow::ensure!(inserted.rows_affected() == 1, "draft is no longer editable");

    tx.commit().await?;
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
#[tracing::instrument(skip(pool), err)]
pub async fn delete_draft_attachment(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;
    if !super::mutation::lock_editable_attachment_message(&mut tx, link_id, draft_id, true).await? {
        return Ok(0);
    }
    let result = sqlx::query!(
        r#"
                WITH editable AS (
                    -- Sent rows are used by the worker's post-delivery cleanup.
                    SELECT id FROM email_messages
                    WHERE id = $2 AND link_id = $3 AND (is_draft OR is_sent)
                    FOR UPDATE
                )
                DELETE FROM email_attachments_drafts ead
                USING editable m
                WHERE ead.draft_id = m.id AND ead.id = $1
                "#,
        attachment_id,
        draft_id,
        link_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
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

/// Fetches draft attachments for multiple draft/message IDs and returns a map keyed by draft_id
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_db_draft_attachments_in_bulk(
    pool: &PgPool,
    draft_ids: &[Uuid],
) -> anyhow::Result<std::collections::HashMap<Uuid, Vec<db::attachment::AttachmentDraft>>> {
    if draft_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let results = sqlx::query_as!(
        db::attachment::AttachmentDraft,
        r#"
            SELECT id, draft_id, file_name, content_type, sha, size, s3_key
            FROM email_attachments_drafts
            WHERE draft_id = ANY($1)
            ORDER BY draft_id, file_name ASC
            "#,
        draft_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut attachments_map: std::collections::HashMap<Uuid, Vec<db::attachment::AttachmentDraft>> =
        std::collections::HashMap::new();
    for attachment in results {
        attachments_map
            .entry(attachment.draft_id)
            .or_default()
            .push(attachment);
    }

    Ok(attachments_map)
}
