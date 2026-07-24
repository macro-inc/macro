use sqlx::types::Uuid;

/// Update the read status of a single message, scoped to the inbox that owns it.
#[tracing::instrument(skip(tx), err)]
pub async fn update_message_read_status(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<Option<Uuid>> {
    let result = sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            id = $2
            AND link_id = $3
        RETURNING id
            "#,
        is_read,
        message_id,
        link_id
    )
    .fetch_optional(tx)
    .await?;

    if result.is_none() {
        tracing::warn!(
            message_id = %message_id,
            link_id = %link_id,
            "No message was updated - message may not exist or doesn't belong to the inbox"
        );
    }

    // Return the ID of the updated message, or None if no message was updated
    Ok(result.map(|r| r.id))
}

/// Update the read status of multiple messages at once.
///
/// Scoped by `link_id` — the inbox that owns the messages — not by the calling user.
/// A delegated or shared inbox is owned by a different macro/fusion user than the
/// caller acting on it, so scoping by the caller would match no rows.
///
/// Returns the count of messages that were successfully updated.
#[tracing::instrument(skip(executor), err)]
pub async fn update_message_read_status_batch<'e, E>(
    executor: E,
    message_ids: Vec<Uuid>,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<usize>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            id = ANY($2)
            AND link_id = $3
        RETURNING id
        "#,
        is_read,
        &message_ids,
        link_id
    )
    .fetch_all(executor)
    .await?;

    let updated_count = result.len();

    // Matching nothing means the ids and the link disagree, which is a scoping bug
    // rather than a race. Fail loudly instead of leaving is_read silently diverged.
    if updated_count == 0 {
        anyhow::bail!(
            "no messages updated for link {link_id}: none of the {} requested ids belong to it",
            message_ids.len()
        );
    }

    if updated_count < message_ids.len() {
        tracing::warn!(
            requested_count = message_ids.len(),
            updated_count = updated_count,
            link_id = %link_id,
            "Some messages were not updated - they may not exist or don't belong to the inbox"
        );
    }

    Ok(updated_count)
}

/// Update the starred status of multiple messages at once, scoped by owning inbox.
/// See [`update_message_read_status_batch`] for why this is not scoped by caller.
#[tracing::instrument(skip(executor), err)]
pub async fn update_message_starred_status_batch<'e, E>(
    executor: E,
    message_ids: Vec<Uuid>,
    link_id: Uuid,
    is_starred: bool,
) -> anyhow::Result<usize>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    if message_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            is_starred = $1,
            updated_at = NOW()
        WHERE
            id = ANY($2)
            AND link_id = $3
        RETURNING id
        "#,
        is_starred,
        &message_ids,
        link_id
    )
    .fetch_all(executor)
    .await?;

    let updated_count = result.len();

    if updated_count < message_ids.len() {
        tracing::warn!(
            requested_count = message_ids.len(),
            updated_count = updated_count,
            link_id = %link_id,
            "Some messages were not updated - they may not exist or don't belong to the inbox"
        );
    }

    Ok(updated_count)
}

/// Updates draft in database to be sent, and populates with provider IDs
#[tracing::instrument(skip(tx), err)]
pub async fn mark_message_as_sent(
    tx: &mut sqlx::PgConnection,
    provider_id: &str,
    provider_thread_id: &str,
    link_id: Uuid,
    db_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            provider_id = $1,
            provider_thread_id = $2,
            is_draft = false,
            is_sent = true,
            updated_at = NOW()
        WHERE
            id = $3
            AND link_id = $4
        "#,
        provider_id,
        provider_thread_id,
        db_id,
        link_id
    )
    .execute(tx)
    .await?;

    Ok(())
}

/// Updates the is_draft status of a message
#[tracing::instrument(skip(tx), err)]
pub async fn update_message_draft_status(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    is_draft: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_messages
        SET
            is_draft = $1,
            updated_at = NOW()
        WHERE
            id = $2
            AND link_id = $3
        "#,
        is_draft,
        message_id,
        link_id
    )
    .execute(tx)
    .await?;

    Ok(())
}
