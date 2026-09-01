#[cfg(test)]
mod test;

use sqlx::types::Uuid;
use sqlx::{Executor, Postgres};

/// Documents whose last `document_email` row is among `attachment_ids`.
///
/// Those documents stay in Macro after the attachments cascade away, but
/// `isEmailAttachment` flips from true to false.
pub async fn documents_losing_last_email_attachment<'e, E>(
    executor: E,
    attachment_ids: &[Uuid],
) -> anyhow::Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if attachment_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT de.document_id
        FROM document_email de
        WHERE de.email_attachment_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM document_email remaining
            WHERE remaining.document_id = de.document_id
              AND remaining.email_attachment_id <> ALL($1::uuid[])
          )
        ORDER BY de.document_id
        "#,
        attachment_ids
    )
    .fetch_all(executor)
    .await?;

    Ok(rows)
}

/// Documents that lose their last email-attachment link when these messages go away.
pub async fn documents_losing_last_email_attachment_for_messages<'e, E>(
    executor: E,
    message_ids: &[Uuid],
) -> anyhow::Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT de.document_id
        FROM document_email de
        JOIN email_attachments ea ON ea.id = de.email_attachment_id
        WHERE ea.message_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM document_email remaining
            JOIN email_attachments remaining_ea ON remaining_ea.id = remaining.email_attachment_id
            WHERE remaining.document_id = de.document_id
              AND remaining_ea.message_id <> ALL($1::uuid[])
          )
        ORDER BY de.document_id
        "#,
        message_ids
    )
    .fetch_all(executor)
    .await?;

    Ok(rows)
}

/// Documents that lose their last email-attachment link when these links go away.
pub async fn documents_losing_last_email_attachment_for_links<'e, E>(
    executor: E,
    link_ids: &[Uuid],
) -> anyhow::Result<Vec<String>>
where
    E: Executor<'e, Database = Postgres>,
{
    if link_ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT de.document_id
        FROM document_email de
        JOIN email_attachments ea ON ea.id = de.email_attachment_id
        JOIN email_messages em ON em.id = ea.message_id
        WHERE em.link_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM document_email remaining
            JOIN email_attachments remaining_ea ON remaining_ea.id = remaining.email_attachment_id
            JOIN email_messages remaining_em ON remaining_em.id = remaining_ea.message_id
            WHERE remaining.document_id = de.document_id
              AND remaining_em.link_id <> ALL($1::uuid[])
          )
        ORDER BY de.document_id
        "#,
        link_ids
    )
    .fetch_all(executor)
    .await?;

    Ok(rows)
}
