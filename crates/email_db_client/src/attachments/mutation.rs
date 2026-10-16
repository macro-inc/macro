/// Serialize attachment changes with send admission using message -> schedule locks.
/// The schedule read is a separate statement so a waiter sees newly committed schedules.
pub(super) async fn lock_editable_attachment_message(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    link_id: sqlx::types::Uuid,
    message_id: sqlx::types::Uuid,
    allow_sent_cleanup: bool,
) -> anyhow::Result<bool> {
    let state = sqlx::query!(
        "SELECT is_draft, is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        message_id,
        link_id
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some(state) = state else {
        return Ok(false);
    };
    if allow_sent_cleanup && state.is_sent {
        return Ok(true);
    }
    if !state.is_draft || state.is_sent {
        return Ok(false);
    }
    let scheduled = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2) AS "scheduled!""#,
        message_id,
        link_id
    ).fetch_one(&mut **tx).await?;
    anyhow::ensure!(
        !scheduled,
        "cancel the scheduled send before changing attachments"
    );
    Ok(true)
}
