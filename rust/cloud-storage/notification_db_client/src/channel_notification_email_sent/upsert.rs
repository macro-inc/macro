use anyhow::Context;
use sqlx::types::Uuid;

#[tracing::instrument(skip(db))]
pub async fn upsert_channel_notification_email_sent_bulk(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<()> {
    if user_ids.is_empty() {
        return Ok(());
    }

    let channel_id =
        macro_uuid::string_to_uuid(channel_id).context("could not convert channel_id to uuid")?;

    sqlx::query!(
        r#"
        INSERT INTO channel_notification_email_sent (channel_id, user_id)
        SELECT $1, u FROM UNNEST($2::text[]) AS u
        ON CONFLICT (channel_id, user_id) DO NOTHING
        "#,
        &channel_id,
        user_ids as &[String],
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn upsert_channel_notification_email_sent_bulk_channel_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    channel_ids: &[String],
) -> anyhow::Result<()> {
    if channel_ids.is_empty() {
        return Ok(());
    }

    let channel_ids = channel_ids
        .iter()
        .map(|id| macro_uuid::string_to_uuid(id))
        .collect::<Result<Vec<Uuid>, _>>()?;

    sqlx::query!(
        r#"
        INSERT INTO channel_notification_email_sent (user_id, channel_id)
        SELECT $1, c FROM UNNEST($2::uuid[]) AS c
        ON CONFLICT (channel_id, user_id) DO NOTHING
        "#,
        user_id,
        &channel_ids,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("channel_notification_email_sent")))]
    async fn test_upsert_channel_notification_email_sent_bulk(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // Existing item
        let channel_id = "11111111-1111-1111-1111-111111111111";
        upsert_channel_notification_email_sent_bulk(
            &pool,
            channel_id,
            &["user1".to_string(), "user2".to_string()],
        )
        .await?;

        let created_at = sqlx::query!(
            r#"
            SELECT created_at
            FROM channel_notification_email_sent
            WHERE channel_id = $1
            AND user_id = $2
            "#,
            macro_uuid::string_to_uuid(channel_id)?,
            "user1"
        )
        .map(|row| row.created_at)
        .fetch_one(&pool)
        .await?;

        let created_at_two = sqlx::query!(
            r#"
            SELECT created_at
            FROM channel_notification_email_sent
            WHERE channel_id = $1
            AND user_id = $2
            "#,
            macro_uuid::string_to_uuid(channel_id)?,
            "user2"
        )
        .map(|row| row.created_at)
        .fetch_one(&pool)
        .await?;

        assert_ne!(created_at, created_at_two);

        Ok(())
    }
}
