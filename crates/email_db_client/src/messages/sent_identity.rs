//! Statement-sized adoption of sent-message identities.
use sqlx::PgConnection;
use sqlx::types::Uuid;

/// Execute the imported_message statement.
pub async fn imported_message(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<Option<Uuid>> {
    let row = sqlx::query!(
        r#"SELECT provider.id FROM email_messages provider
           JOIN email_messages local ON local.id = $3 AND local.link_id = $1
           WHERE provider.link_id = $1 AND provider.provider_id = $2 AND provider.id <> $3
           FOR UPDATE OF provider"#,
        link_id,
        provider_id,
        message_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    Ok(row.map(|row| row.id))
}

/// Execute the adopt_metadata statement.
pub async fn adopt_metadata(
    tx: &mut PgConnection,
    link_id: Uuid,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE email_messages local SET
             global_id = provider.global_id,
             provider_history_id = provider.provider_history_id,
             internal_date_ts = COALESCE(provider.internal_date_ts, local.internal_date_ts),
             snippet = provider.snippet, size_estimate = provider.size_estimate,
             sent_at = COALESCE(provider.sent_at, local.sent_at),
             has_attachments = local.has_attachments OR provider.has_attachments,
             is_read = provider.is_read, is_starred = local.is_starred OR provider.is_starred,
             headers_jsonb = provider.headers_jsonb
           FROM email_messages provider
           WHERE local.id = $1 AND local.link_id = $3 AND provider.id = $2"#,
        message_id,
        imported_id,
        link_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_labels statement.
pub async fn adopt_labels(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_message_labels (message_id, label_id)
           SELECT $1, label_id FROM email_message_labels WHERE message_id = $2
           ON CONFLICT DO NOTHING"#,
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_recipients statement.
pub async fn adopt_recipients(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_message_recipients (message_id, contact_id, recipient_type, name)
           SELECT $1, contact_id, recipient_type, name
           FROM email_message_recipients WHERE message_id = $2
           ON CONFLICT (message_id, contact_id, recipient_type) DO UPDATE
           SET name = COALESCE(EXCLUDED.name, email_message_recipients.name)"#,
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_calendar statement.
pub async fn adopt_calendar(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_message_calendar_invites (message_id, component_id, snapshot)
           SELECT $1, component_id, snapshot FROM email_message_calendar_invites WHERE message_id = $2
           ON CONFLICT (message_id, component_id) DO UPDATE SET snapshot = EXCLUDED.snapshot"#,
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_replies statement.
pub async fn adopt_replies(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_messages SET replying_to_id = $1 WHERE replying_to_id = $2",
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_client_ids statement.
pub async fn adopt_client_ids(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_draft_client_ids SET message_id = $1 WHERE message_id = $2",
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_draft_attachments statement.
pub async fn adopt_draft_attachments(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_attachments_drafts SET draft_id = $1 WHERE draft_id = $2",
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_forwarded_attachments statement.
pub async fn adopt_forwarded_attachments(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_attachments_fwd (message_id, attachment_id, created_at)
           SELECT $1, attachment_id, created_at FROM email_attachments_fwd WHERE message_id = $2
           ON CONFLICT DO NOTHING"#,
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the remove_imported_message statement.
pub async fn remove_imported_message(
    tx: &mut PgConnection,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", imported_id)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

/// Execute the duplicate_attachments statement.
pub async fn duplicate_attachments(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<Vec<(Uuid, Uuid)>> {
    let rows = sqlx::query!(
        r#"SELECT local.id AS local_id, provider.id AS provider_id
           FROM email_attachments local JOIN email_attachments provider
             ON provider.provider_attachment_id = local.provider_attachment_id
           WHERE local.message_id = $1 AND provider.message_id = $2"#,
        message_id,
        imported_id,
    )
    .fetch_all(&mut *tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.local_id, row.provider_id))
        .collect())
}

/// Execute the adopt_attachment_storage statement.
pub async fn adopt_attachment_storage(
    tx: &mut PgConnection,
    provider_attachment_id: Uuid,
    local_attachment_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_attachments_sfs SET attachment_id = $1 WHERE attachment_id = $2",
        provider_attachment_id,
        local_attachment_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_forwarded_references statement.
pub async fn adopt_forwarded_references(
    tx: &mut PgConnection,
    provider_attachment_id: Uuid,
    local_attachment_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO email_attachments_fwd (message_id, attachment_id, created_at)
               SELECT message_id, $1, created_at FROM email_attachments_fwd WHERE attachment_id = $2
               ON CONFLICT DO NOTHING"#,
        provider_attachment_id,
        local_attachment_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_document_references statement.
pub async fn adopt_document_references(
    tx: &mut PgConnection,
    provider_attachment_id: Uuid,
    local_attachment_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO document_email (document_id, email_attachment_id)
               SELECT document_id, $1 FROM document_email WHERE email_attachment_id = $2
               ON CONFLICT DO NOTHING"#,
        provider_attachment_id,
        local_attachment_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the remove_duplicate_attachment statement.
pub async fn remove_duplicate_attachment(
    tx: &mut PgConnection,
    local_attachment_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM email_attachments WHERE id = $1",
        local_attachment_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Execute the adopt_attachments statement.
pub async fn adopt_attachments(
    tx: &mut PgConnection,
    message_id: Uuid,
    imported_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_attachments SET message_id = $1 WHERE message_id = $2",
        message_id,
        imported_id,
    )
    .execute(&mut *tx)
    .await?;
    Ok(())
}
