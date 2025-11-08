use std::collections::{HashMap, HashSet};

use anyhow::Context;
use sqlx::types::Uuid;

use super::ChannelNotificationEmailSent;

/// Given a channel id and a list of user ids, this returns a hashmap of the user_id and the
/// channel_notification_email_sent for that user.
/// The channel_notification_email_sent is removed from the database when a user calls
/// SEEN or DONE for the channel/notification that belongs to the channel in the case of BULK
/// seen/done.
#[tracing::instrument(skip(db))]
pub async fn get_channel_notification_email_sent_bulk(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<HashMap<String, ChannelNotificationEmailSent>> {
    let channel_id =
        macro_uuid::string_to_uuid(channel_id).context("could not convert channel_id to uuid")?;

    let result: Vec<ChannelNotificationEmailSent> = sqlx::query_as!(
        ChannelNotificationEmailSent,
        r#"
        SELECT channel_id, user_id, created_at
        FROM channel_notification_email_sent
        WHERE channel_id = $1
        AND user_id = ANY($2)
        "#,
        &channel_id,
        user_ids
    )
    .fetch_all(db)
    .await?;

    let mut result_map: HashMap<String, ChannelNotificationEmailSent> = HashMap::new();

    for row in result {
        result_map.insert(row.user_id.clone(), row);
    }

    Ok(result_map)
}

#[tracing::instrument(skip(db))]
pub async fn get_channel_notification_email_sent_bulk_by_channel_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    channel_ids: &[String],
) -> anyhow::Result<HashSet<String>> {
    let channel_ids = channel_ids
        .iter()
        .map(|channel_id| macro_uuid::string_to_uuid(channel_id).unwrap())
        .collect::<Vec<Uuid>>();

    let result: Vec<Uuid> = sqlx::query!(
        r#"
        SELECT channel_id
        FROM channel_notification_email_sent
        WHERE user_id = $1
        AND channel_id = ANY($2)
        "#,
        user_id,
        &channel_ids
    )
    .map(|row| row.channel_id)
    .fetch_all(db)
    .await?;

    let result = result
        .into_iter()
        .map(|channel_id| channel_id.to_string())
        .collect();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("channel_notification_email_sent")))]
    async fn test_get_channel_notification_email_sent_bulk(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let result = get_channel_notification_email_sent_bulk(
            &pool,
            "11111111-1111-1111-1111-111111111111",
            &[
                "user1".to_string(),
                "user2".to_string(),
                "user3".to_string(),
            ],
        )
        .await?;

        assert_eq!(result.len(), 1);

        let user1 = result.get("user1").unwrap();

        assert_eq!(user1.channel_id, "11111111-1111-1111-1111-111111111111");
        assert_eq!(user1.user_id, "user1");
        assert_eq!(
            user1.created_at,
            chrono::NaiveDateTime::parse_from_str("2019-10-16 00:00:00", "%Y-%m-%d %H:%M:%S")
                .unwrap()
        );

        Ok(())
    }
}
