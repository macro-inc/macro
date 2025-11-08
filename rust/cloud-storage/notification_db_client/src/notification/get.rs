#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BasicNotification {
    pub event_item_id: String,
    pub event_item_type: String,
    pub notification_event_type: String,
}

/// Gets a notification by id
#[tracing::instrument(skip(db))]
pub async fn get_basic_notification(
    db: &sqlx::PgPool,
    notification_id: &str,
) -> anyhow::Result<BasicNotification> {
    let notification = sqlx::query_as!(
        BasicNotification,
        r#"
        SELECT
            n.event_item_id,
            n.event_item_type,
            n.notification_event_type
        FROM notification n
        WHERE n.id = $1
        "#,
        macro_uuid::string_to_uuid(notification_id)?
    )
    .fetch_one(db)
    .await?;

    Ok(notification)
}
