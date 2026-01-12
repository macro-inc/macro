use std::str::FromStr;

use macro_user_id::{cowlike::CowLike, error::ParseErr, user_id::MacroUserIdStr};
use model_entity::EntityType;
use model_notifications::RawUserNotification;
use sqlx::Row;
use sqlx::types::Uuid;

/// Gets a single user notification by its notification id.
#[tracing::instrument(skip(db))]
pub async fn get_user_notification_by_id(
    db: &sqlx::PgPool,
    user_id: &str,
    notification_id: Uuid,
) -> anyhow::Result<Option<RawUserNotification>> {
    let row = sqlx::query(
        r#"
    SELECT
        un.user_id as owner_id,
        un.notification_id,
        n.event_item_id,
        n.event_item_type,
        un.sent,
        un.done,
        un.created_at::timestamptz,
        un.seen_at::timestamptz as viewed_at,
        un.created_at::timestamptz as updated_at,
        un.deleted_at::timestamptz,
        n.metadata as notification_metadata,
        n.notification_event_type as notification_event_type,
        n.sender_id as sender_id
    FROM user_notification un
    JOIN notification n ON n.id = un.notification_id
    WHERE un.user_id = $1
      AND un.notification_id = $2
      AND un.deleted_at IS NULL
    LIMIT 1
    "#,
    )
    .bind(user_id)
    .bind(notification_id)
    .try_map(|row| {
        let event_item_type: String = row.try_get("event_item_type")?;
        let event_item_id: String = row.try_get("event_item_id")?;

        let sender_id: Option<String> = row.try_get("sender_id")?;

        Ok(RawUserNotification {
            owner_id: row.try_get("owner_id")?,
            notification_id: row.try_get("notification_id")?,
            notification_event_type: row.try_get("notification_event_type")?,
            entity: EntityType::from_str(&event_item_type)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .with_entity_string(event_item_id),
            sent: row.try_get("sent")?,
            done: row.try_get("done")?,
            created_at: row.try_get("created_at")?,
            viewed_at: row.try_get("viewed_at")?,
            deleted_at: row.try_get("deleted_at")?,
            notification_metadata: row.try_get("notification_metadata")?,
            sender_id: sender_id
                .map(|s| Result::<_, ParseErr>::Ok(MacroUserIdStr::parse_from_str(&s)?.into_owned()))
                .transpose()
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            updated_at: row.try_get("updated_at")?,
        })
    })
    .fetch_optional(db)
    .await?;

    Ok(row)
}

