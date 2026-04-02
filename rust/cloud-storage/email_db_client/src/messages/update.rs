use sqlx::types::Uuid;

#[tracing::instrument(skip(tx), err)]
pub async fn update_message_read_status(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    fusionauth_user_id: &str,
    is_read: bool,
) -> anyhow::Result<Option<Uuid>> {
    let result = sqlx::query!(
        r#"
        UPDATE email_messages m
        SET
            is_read = $1,
            updated_at = NOW()
        FROM email_links l
        WHERE
            m.id = $2
            AND m.link_id = l.id
            AND l.fusionauth_user_id = $3
        RETURNING m.id
            "#,
        is_read,
        message_id,
        fusionauth_user_id
    )
    .fetch_optional(tx)
    .await?;

    if result.is_none() {
        tracing::warn!(
            message_id = %message_id,
            user_id = %fusionauth_user_id,
            "No message was updated - message may not exist or doesn't belong to the user"
        );
    }

    // Return the ID of the updated message, or None if no message was updated
    Ok(result.map(|r| r.id))
}

/// Update the read status of multiple messages at once
/// Returns the count of messages that were successfully updated
#[tracing::instrument(skip(executor), err)]
pub async fn update_message_read_status_batch<'e, E>(
    executor: E,
    message_ids: Vec<Uuid>,
    fusionauth_user_id: &str,
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
        UPDATE email_messages m
        SET
            is_read = $1,
            updated_at = NOW()
        FROM email_links l
        WHERE
            m.id = ANY($2)
            AND m.link_id = l.id
            AND l.fusionauth_user_id = $3
        RETURNING m.id
        "#,
        is_read,
        &message_ids,
        fusionauth_user_id
    )
    .fetch_all(executor)
    .await?;

    let updated_count = result.len();

    if updated_count < message_ids.len() {
        tracing::warn!(
            requested_count = message_ids.len(),
            updated_count = updated_count,
            user_id = %fusionauth_user_id,
            "Some messages were not updated - they may not exist or don't belong to the user"
        );
    }

    Ok(updated_count)
}

#[tracing::instrument(skip(executor), err)]
pub async fn update_message_starred_status_batch<'e, E>(
    executor: E,
    message_ids: Vec<Uuid>,
    fusionauth_user_id: &str,
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
        UPDATE email_messages m
        SET
            is_starred = $1,
            updated_at = NOW()
        FROM email_links l
        WHERE
            m.id = ANY($2)
            AND m.link_id = l.id
            AND l.fusionauth_user_id = $3
        RETURNING m.id
        "#,
        is_starred,
        &message_ids,
        fusionauth_user_id
    )
    .fetch_all(executor)
    .await?;

    let updated_count = result.len();

    if updated_count < message_ids.len() {
        tracing::warn!(
            requested_count = message_ids.len(),
            updated_count = updated_count,
            user_id = %fusionauth_user_id,
            "Some messages were not updated - they may not exist or don't belong to the user"
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
