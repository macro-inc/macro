use models_email::{db, service};
use sqlx::PgPool;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// Inserts a forwarded attachment link between a draft and an original message's attachment.
/// Uses a subquery to verify the draft belongs to the given link_id.
/// ON CONFLICT DO NOTHING makes this idempotent.
#[tracing::instrument(skip(pool), err)]
pub async fn insert_forwarded_attachment(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    if !super::mutation::lock_editable_attachment_message(&mut tx, link_id, draft_id, false).await?
    {
        return Ok(());
    }
    sqlx::query!(
        r#"
        WITH editable AS (
            SELECT id FROM email_messages
            WHERE id = $1 AND link_id = $3 AND is_draft AND NOT is_sent
            FOR UPDATE
        )
        INSERT INTO email_attachments_fwd (message_id, attachment_id)
            SELECT $1, $2
            FROM editable
        ON CONFLICT DO NOTHING
        "#,
        draft_id,
        attachment_id,
        link_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Deletes a forwarded attachment link. Verifies draft ownership via link_id.
#[tracing::instrument(skip(pool), err)]
pub async fn delete_forwarded_attachment(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
    attachment_id: Uuid,
) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;
    if !super::mutation::lock_editable_attachment_message(&mut tx, link_id, draft_id, false).await?
    {
        return Ok(0);
    }
    let result = sqlx::query!(
        r#"
        WITH editable AS (
            SELECT id FROM email_messages
            WHERE id = $1 AND link_id = $3 AND is_draft AND NOT is_sent
            FOR UPDATE
        )
        DELETE FROM email_attachments_fwd eaf
        USING editable m
        WHERE eaf.message_id = m.id AND eaf.attachment_id = $2
        "#,
        draft_id,
        attachment_id,
        link_id,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(result.rows_affected())
}

/// Fetches all forwarded attachments for a given draft, joining email_attachments
/// for metadata and email_messages for the original message's provider_id.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_forwarded_attachments_by_draft_id(
    pool: &PgPool,
    link_id: Uuid,
    draft_id: Uuid,
) -> anyhow::Result<Vec<service::attachment::AttachmentForwarded>> {
    let db_attachments = sqlx::query_as!(
        db::attachment::AttachmentForwarded,
        r#"
        SELECT
            eaf.attachment_id,
            eaf.message_id AS draft_id,
            ea.provider_attachment_id,
            orig_msg.provider_id AS "message_provider_id!",
            ea.filename,
            ea.mime_type,
            ea.size_bytes
        FROM email_attachments_fwd eaf
        JOIN email_messages draft_msg ON eaf.message_id = draft_msg.id
        JOIN email_attachments ea ON eaf.attachment_id = ea.id
        JOIN email_messages orig_msg ON ea.message_id = orig_msg.id
        WHERE eaf.message_id = $1 AND draft_msg.link_id = $2
        ORDER BY ea.filename ASC
        "#,
        draft_id,
        link_id,
    )
    .fetch_all(pool)
    .await?;

    let service_attachments = db_attachments
        .into_iter()
        .map(service::attachment::AttachmentForwarded::from)
        .collect();

    Ok(service_attachments)
}

/// Fetches forwarded attachments for multiple draft IDs and returns a map keyed by draft_id.
#[tracing::instrument(skip(pool), err)]
pub async fn fetch_forwarded_attachments_in_bulk(
    pool: &PgPool,
    draft_ids: &[Uuid],
) -> anyhow::Result<std::collections::HashMap<Uuid, Vec<db::attachment::AttachmentForwarded>>> {
    if draft_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let results = sqlx::query_as!(
        db::attachment::AttachmentForwarded,
        r#"
        SELECT
            eaf.attachment_id,
            eaf.message_id AS draft_id,
            ea.provider_attachment_id,
            orig_msg.provider_id AS "message_provider_id!",
            ea.filename,
            ea.mime_type,
            ea.size_bytes
        FROM email_attachments_fwd eaf
        JOIN email_attachments ea ON eaf.attachment_id = ea.id
        JOIN email_messages orig_msg ON ea.message_id = orig_msg.id
        WHERE eaf.message_id = ANY($1)
        ORDER BY eaf.message_id, ea.filename ASC
        "#,
        draft_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut attachments_map: std::collections::HashMap<
        Uuid,
        Vec<db::attachment::AttachmentForwarded>,
    > = std::collections::HashMap::new();
    for attachment in results {
        attachments_map
            .entry(attachment.draft_id)
            .or_default()
            .push(attachment);
    }

    Ok(attachments_map)
}
