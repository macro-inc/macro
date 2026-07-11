/// Deletes the channel_notification_email_sent for the given channel id and user id.
#[tracing::instrument(skip(db))]
pub async fn delete_channel_notification_email_sent(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM channel_notification_email_sent
        WHERE channel_id = $1 AND user_id = $2
        "#,
        macro_uuid::string_to_uuid(channel_id)?,
        user_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn delete_channel_notification_email_sent_by_notification_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    notification_ids: &[uuid::Uuid],
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM channel_notification_email_sent
        USING notification n
        WHERE n.id = ANY($1)
        AND n.event_item_type = 'channel'
        AND channel_notification_email_sent.channel_id = n.event_item_id::uuid
        AND channel_notification_email_sent.user_id = $2;
        "#,
        notification_ids,
        &user_id
    )
    .execute(db)
    .await?;

    Ok(())
}
