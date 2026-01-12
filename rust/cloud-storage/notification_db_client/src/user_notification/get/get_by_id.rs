use std::str::FromStr;

use macro_user_id::{cowlike::CowLike, error::ParseErr, user_id::MacroUserIdStr};
use model_entity::EntityType;
use model_notifications::RawUserNotification;
use sqlx::types::Uuid;

/// Gets a single user notification by its notification id.
#[tracing::instrument(skip(db))]
pub async fn get_user_notification_by_id(
    db: &sqlx::PgPool,
    user_id: &str,
    notification_id: Uuid,
) -> anyhow::Result<Option<RawUserNotification>> {
    let row = sqlx::query!(
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
        user_id,
        notification_id,
    )
    .fetch_optional(db)
    .await?;

    let notification = row
        .map(|row| -> Result<RawUserNotification, sqlx::Error> {
            Ok(RawUserNotification {
                owner_id: row.owner_id,
                notification_id: row.notification_id,
                notification_event_type: row.notification_event_type,
                entity: EntityType::from_str(&row.event_item_type)
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                    .with_entity_string(row.event_item_id),
                sent: row.sent,
                done: row.done,
                created_at: row.created_at,
                viewed_at: row.viewed_at,
                deleted_at: row.deleted_at,
                notification_metadata: row.notification_metadata,
                sender_id: row
                    .sender_id
                    .map(|s| {
                        Result::<_, ParseErr>::Ok(MacroUserIdStr::parse_from_str(&s)?.into_owned())
                    })
                    .transpose()
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
                updated_at: row.updated_at,
            })
        })
        .transpose()?;

    Ok(notification)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_get_user_notification_by_id_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76".parse::<Uuid>()?;

        let notification =
            get_user_notification_by_id(&pool, "macro|user@user.com", notification_id)
                .await?
                .expect("expected notification to exist");

        assert_eq!(notification.owner_id, "macro|user@user.com");
        assert_eq!(notification.notification_id, notification_id);
        assert_eq!(notification.notification_event_type, "test");
        assert_eq!(notification.entity.entity_type, EntityType::Document);
        assert_eq!(notification.entity.entity_id.as_ref(), "test");
        assert!(!notification.sent);
        assert!(!notification.done);
        assert!(notification.sender_id.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_get_user_notification_by_id_wrong_user(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76".parse::<Uuid>()?;

        let notification =
            get_user_notification_by_id(&pool, "macro|someone@else.com", notification_id).await?;

        assert!(notification.is_none());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_get_user_notification_by_id_ignores_deleted(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76".parse::<Uuid>()?;

        sqlx::query!(
            r#"
            UPDATE user_notification
            SET deleted_at = NOW()
            WHERE user_id = $1
              AND notification_id = $2
            "#,
            "macro|user@user.com",
            notification_id,
        )
        .execute(&pool)
        .await?;

        let notification =
            get_user_notification_by_id(&pool, "macro|user@user.com", notification_id).await?;

        assert!(notification.is_none());

        Ok(())
    }
}
