use sqlx::types::Uuid;

/// Deletes a scheduled message if it exists
#[tracing::instrument(skip(executor), err)]
pub async fn delete_scheduled_message<'e, E>(
    executor: E,
    link_id: Uuid,
    message_id: Uuid,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        DELETE FROM email_scheduled_messages
        WHERE link_id = $1 AND message_id = $2
        "#,
        link_id,
        message_id,
    )
    .execute(executor)
    .await?;

    Ok(())
}
