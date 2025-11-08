use cached::proc_macro::cached;
#[allow(unused_imports)]
use model::comms::{Channel, ChannelParticipant, ChannelType, ChannelWithParticipants};
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

#[tracing::instrument(skip(db))]
#[cached(
    time = 5,
    result = true,
    key = "String",
    convert = r#"{ user_id.to_string() }"#
)]
pub async fn get_user_channel_ids(
    db: &Pool<Postgres>,
    user_id: &str,
    user_org_id: Option<i64>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let channels = sqlx::query!(
        r#"
        WITH user_channels AS (
            SELECT DISTINCT c.*
            FROM comms_channels c
            INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
            
            UNION
            
            SELECT c.*
            FROM comms_channels c
            WHERE c.channel_type = 'organization'::comms_channel_type
            AND c.org_id = $2::bigint
        )
        SELECT 
            id as "id!"
        FROM user_channels
        ORDER BY created_at DESC
        "#,
        user_id,
        user_org_id
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(channels)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_channels_with_participants(
    db: &Pool<Postgres>,
    user_id: &str,
) -> Result<Vec<ChannelWithParticipants>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        WITH user_channels AS (
            SELECT DISTINCT c.*
            FROM comms_channels c
            INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
        ),
        channel_participants_json AS (
            SELECT 
                uc.id as channel_id,
                ARRAY_AGG(
                    json_build_object(
                        'channel_id', cp.channel_id,
                        'user_id', cp.user_id,
                        'role', cp.role,
                        'joined_at', cp.joined_at,
                        'left_at', cp.left_at
                    )
                ) as participants
            FROM user_channels uc
            JOIN comms_channel_participants cp ON cp.channel_id = uc.id
            WHERE cp.left_at IS NULL
            GROUP BY uc.id
        )
        SELECT 
            uc.id as "id!",
            uc.name as "name",
            uc.channel_type as "channel_type!: ChannelType",
            uc.org_id,
            uc.created_at as "created_at!",
            uc.updated_at as "updated_at!",
            uc.owner_id as "owner_id!",
            cpj.participants as "participants_json?"
        FROM user_channels uc
        LEFT JOIN channel_participants_json cpj ON cpj.channel_id = uc.id
        ORDER BY uc.created_at DESC
        "#,
        user_id
    )
    .fetch_all(db)
    .await?;

    let channels_with_participants = rows
        .into_iter()
        .map(|row| {
            let channel = Channel {
                id: row.id,
                name: row.name,
                channel_type: row.channel_type,
                org_id: row.org_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                owner_id: row.owner_id,
            };

            let participants = row
                .participants_json
                .map(|json_array| {
                    json_array
                        .iter()
                        .filter_map(|json_value| {
                            serde_json::from_value::<ChannelParticipant>(json_value.clone()).ok()
                        })
                        .collect::<Vec<ChannelParticipant>>()
                })
                .unwrap_or_default();

            ChannelWithParticipants {
                channel,
                participants,
            }
        })
        .collect();

    Ok(channels_with_participants)
}

pub async fn get_org_channels(
    db: &Pool<Postgres>,
    org_id: &i64,
) -> Result<Vec<Channel>, sqlx::Error> {
    let channels = sqlx::query_as!(
        Channel,
        r#"
        SELECT 
            id as "id!",
            name as "name!",
            channel_type as "channel_type!: ChannelType",
            org_id,  -- This can be NULL
            created_at as "created_at!",
            updated_at as "updated_at!",
            owner_id as "owner_id!"
        FROM comms_channels
        WHERE channel_type = 'organization'::comms_channel_type
        AND org_id = $1::bigint
        ORDER BY created_at DESC
        "#,
        org_id
    )
    .fetch_all(db)
    .await?;

    Ok(channels)
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
