use sqlx::types::Uuid;

/// Deletes a thread if it has no associated messages
#[tracing::instrument(skip(tx), err)]
pub async fn delete_thread_if_empty(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> anyhow::Result<bool> {
    let messages_exist = sqlx::query!(
        r#"SELECT EXISTS(SELECT 1 FROM email_messages WHERE thread_id = $1) AS "exists!""#,
        thread_id
    )
    .fetch_one(&mut *tx)
    .await?
    .exists;

    if messages_exist {
        return Ok(false);
    }

    // No messages exist, delete the thread
    let result = sqlx::query!(r#"DELETE FROM email_threads WHERE id = $1"#, thread_id)
        .execute(&mut *tx)
        .await?;

    if result.rows_affected() == 0 {
        tracing::warn!(thread_id = %thread_id, "Thread not found for deletion");
        return Ok(false);
    }

    Ok(true)
}
