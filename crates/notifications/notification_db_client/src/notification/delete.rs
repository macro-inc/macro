pub async fn delete_notification_by_event_item(
    db: &sqlx::Pool<sqlx::Postgres>,
    event_item_id: &str,
    event_item_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            DELETE FROM notification
            WHERE event_item_id = $1 AND event_item_type = $2
        "#,
        event_item_id,
        event_item_type,
    )
    .execute(db)
    .await?;

    Ok(())
}
