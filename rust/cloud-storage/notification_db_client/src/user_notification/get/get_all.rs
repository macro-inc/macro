use model_notifications::RawUserNotification;
use models_pagination::{CreatedAt, Query};
use sqlx::types::Uuid;

/// Gets all the user notifications in a cursor paginated format.
#[tracing::instrument(skip(db))]
pub async fn get_all_user_notifications(
    db: &sqlx::PgPool,
    user_id: &str,
    limit: u32,
    cursor: Query<Uuid, CreatedAt, ()>,
) -> anyhow::Result<Vec<RawUserNotification>> {
    let query_limit = limit as i64;
    let (cursor_id, cursor_timestamp) = cursor.vals();

    let notifications = sqlx::query_as!(
        RawUserNotification,
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
        n.sender_id as sender_id,
        un.is_important_v0 as is_important_v0
    FROM user_notification un
    JOIN notification n ON n.id = un.notification_id
    WHERE un.user_id = $1
    AND un.deleted_at IS NULL
    AND un.done = false
    AND (($3::timestamptz IS NULL)
        OR (un.created_at, un.notification_id) < ($3, $4))
    ORDER BY un.created_at DESC, un.notification_id DESC
    LIMIT $2
    "#,
        user_id,
        query_limit,
        cursor_timestamp,
        cursor_id as _, // have to cast to Option<Uuid> since notification id is a uuid
    )
    .fetch_all(db)
    .await?;

    Ok(notifications)
}

/// Gets all the user notifications for a given entity id in a cursor paginated format.
/// NOTE: This will include "done" notifications but not deleted ones
#[tracing::instrument(skip(db))]
pub async fn get_all_user_notifications_by_event_item_ids(
    db: &sqlx::PgPool,
    user_id: &str,
    event_item_id: &[impl ToString + std::fmt::Debug],
    limit: u32,
    cursor: Query<Uuid, CreatedAt, ()>,
) -> anyhow::Result<Vec<RawUserNotification>> {
    let query_limit = limit as i64;
    let (cursor_id, cursor_timestamp) = cursor.vals();

    let event_item_id: Vec<String> = event_item_id.iter().map(|e| e.to_string()).collect();

    let notifications = sqlx::query_as!(
        RawUserNotification,
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
        n.sender_id as sender_id,
        un.is_important_v0 as is_important_v0
    FROM user_notification un
    JOIN notification n ON n.id = un.notification_id
    WHERE un.user_id = $1
    AND n.event_item_id = ANY($2)
    AND un.deleted_at IS NULL
    AND un.done = false
    AND (($4::timestamptz IS NULL)
        OR (un.created_at, un.notification_id) < ($4, $5))
    ORDER BY un.created_at DESC, un.notification_id DESC
    LIMIT $3
    "#,
        user_id,
        &event_item_id,
        query_limit,
        cursor_timestamp,
        cursor_id as _, // have to cast to Option<Uuid> since notification id is a uuid
    )
    .fetch_all(db)
    .await?;

    Ok(notifications)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use models_pagination::{Base64Str, Cursor, CursorVal, PaginateOn, TypeEraseCursor};
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_get_user_notifications(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let paginated_result =
            get_all_user_notifications(&pool, "macro|user@user.com", 1, Query::Sort(CreatedAt, ()))
                .await?;

        assert_eq!(paginated_result.len(), 1);
        let paginated = paginated_result
            .into_iter()
            .paginate_on(1, CreatedAt)
            .into_page()
            .type_erase();
        assert_eq!(
            paginated.next_cursor.unwrap(),
            Base64Str::encode_json(Cursor {
                id: paginated.items.first().unwrap().notification_id,
                limit: 1,
                filter: (),
                val: CursorVal {
                    sort_type: CreatedAt,
                    last_val: paginated
                        .items
                        .last()
                        .unwrap()
                        .created_at
                        .unwrap_or(DateTime::UNIX_EPOCH),
                }
            })
            .type_erase()
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_get_user_notifications_by_event_item_ids(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let paginated_result = get_all_user_notifications_by_event_item_ids(
            &pool,
            "macro|user@user.com",
            &["test"],
            1,
            Query::Sort(CreatedAt, ()),
        )
        .await?
        .into_iter()
        .paginate_on(1, CreatedAt)
        .into_page()
        .type_erase();

        assert_eq!(paginated_result.items.len(), 1);
        assert_eq!(
            paginated_result.next_cursor.unwrap(),
            Base64Str::encode_json(Cursor {
                id: paginated_result.items.last().unwrap().notification_id,
                limit: 1,
                filter: (),
                val: CursorVal {
                    sort_type: CreatedAt,
                    last_val: paginated_result
                        .items
                        .last()
                        .unwrap()
                        .created_at
                        .unwrap_or(DateTime::UNIX_EPOCH),
                },
            })
            .type_erase()
        );

        Ok(())
    }
}
