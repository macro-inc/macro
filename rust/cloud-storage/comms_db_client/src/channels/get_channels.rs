use cached::proc_macro::cached;
use model::comms::Channel;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Checks if a user has access to a given channel
pub async fn check_channels_for_user(
    db: &Pool<Postgres>,
    user_id: &str,
    channel_ids: &[Uuid],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let channels = sqlx::query!(
        r#"
        SELECT c.id
        FROM comms_channels c
        INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id 
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
        AND c.id = ANY($2::uuid[])
        "#,
        user_id,
        channel_ids
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(channels)
}

#[tracing::instrument(skip(db, _user_org_id))]
#[cached(
    time = 5,
    result = true,
    key = "String",
    convert = r#"{ user_id.to_string() }"#
)]
pub async fn get_user_channel_ids(
    db: &Pool<Postgres>,
    user_id: &str,
    _user_org_id: Option<i64>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let channels = sqlx::query!(
        r#"
        WITH user_channels AS (
            SELECT DISTINCT c.id, c.created_at
            FROM comms_channels c
            INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
        )
        SELECT
            id as "id!"
        FROM user_channels
        ORDER BY created_at DESC
        "#,
        user_id,
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(channels)
}

pub async fn get_org_channels(
    _db: &Pool<Postgres>,
    _org_id: &i64,
) -> Result<Vec<Channel>, sqlx::Error> {
    Ok(Vec::new())
}

/// Returns a paginated list of project IDs, sorting by ascending so we don't miss new ones
#[tracing::instrument(skip(db))]
pub async fn get_all_channel_ids_paginated(
    db: &sqlx::Pool<sqlx::Postgres>,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT
            id as "channel_id"
        FROM
            comms_channels
        ORDER BY
            created_at ASC
        LIMIT $1
        OFFSET $2
        "#,
        limit,
        offset
    )
    .map(|row| row.channel_id.to_string())
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions"))
    )]
    async fn test_check_channels_for_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let channels: Vec<Uuid> = vec![
            "11111111-1111-1111-1111-111111111111".parse().unwrap(),
            "22222222-2222-2222-2222-222222222222".parse().unwrap(),
        ];

        let channels = check_channels_for_user(&pool, "user1", &channels).await?;

        assert_eq!(channels.len(), 1);
        assert_eq!(
            channels[0].to_string(),
            "11111111-1111-1111-1111-111111111111".to_string()
        );

        Ok(())
    }
}
