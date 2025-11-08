use std::collections::HashMap;

use model_notifications::NotificationEventType;

#[tracing::instrument(skip(db))]
pub async fn should_email_based_on_user_notification_bulk(
    db: &sqlx::PgPool,
    notification_event_type: &NotificationEventType,
    event_item_id: &str,
    event_item_type: &str,
    user_ids: &[String],
) -> anyhow::Result<Vec<(String, bool)>> {
    // Contains a list of all user notification events that match this criteria
    // there may be duplicates for a single user_id and some user_ids may not exist
    let result: Vec<(String, i64)> = sqlx::query!(
        r#"
        SELECT un.user_id, COUNT(*) as count
        FROM user_notification un
        JOIN notification n ON n.id = un.notification_id
        WHERE un.user_id = ANY($1)
            AND n.notification_event_type = $2
            AND n.event_item_id =  $3
            AND n.event_item_type = $4
        GROUP BY un.user_id
        ORDER BY un.user_id
        "#,
        user_ids,
        &notification_event_type.to_string(),
        event_item_id,
        event_item_type
    )
    .map(|row| (row.user_id, row.count.unwrap_or(0)))
    .fetch_all(db)
    .await?;

    let should_email_map: HashMap<String, bool> = result
        .iter()
        .map(|(user_id, count)| (user_id.to_string(), count <= &1)) // If there is more than 1 notification, we should not email them
        .collect();

    let result = user_ids
        .iter()
        .map(|user_id| {
            let should_email = should_email_map.get(user_id).unwrap_or(&true);
            (user_id.clone(), *should_email)
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("should_email")))]
    async fn test_should_email_based_on_user_notification_bulk(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let user_ids = vec![
            "macro|user@user.com".to_string(),
            "macro|user2@user.com".to_string(),
            "macro|user3@user.com".to_string(),
        ];

        let should_email = should_email_based_on_user_notification_bulk(
            &pool,
            &NotificationEventType::ItemSharedUser,
            "item_id",
            "item_type",
            &user_ids,
        )
        .await?;

        assert_eq!(should_email.len(), 3);
        assert_eq!(should_email[0].0, "macro|user@user.com");
        assert!(should_email[0].1);
        assert_eq!(should_email[1].0, "macro|user2@user.com");
        assert!(should_email[1].1);
        assert_eq!(should_email[2].0, "macro|user3@user.com");
        assert!(should_email[2].1);
        Ok(())
    }
}
