use sqlx::types::Uuid;

/// Read the existing empty-thread predicate in the caller's transaction.
pub async fn thread_has_messages(
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

    Ok(messages_exist)
}

/// Delete the selected empty thread and return the affected count.
pub async fn delete_empty_thread(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> anyhow::Result<u64> {
    let result = sqlx::query!(r#"DELETE FROM email_threads WHERE id = $1"#, thread_id)
        .execute(&mut *tx)
        .await?;

    Ok(result.rows_affected())
}
