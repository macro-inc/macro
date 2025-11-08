use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct ChannelId {
    id: Uuid,
}
/// Tries to fetch a channel that has a certain list of participants
/// and is of type [ChannelType::Private]
pub async fn maybe_get_private_channel(
    db: &Pool<Postgres>,
    participants: &Vec<String>,
) -> Result<Option<Uuid>> {
    let channel = sqlx::query_as!(
        ChannelId,
        r#"
        SELECT id
        FROM comms_channels
        WHERE channel_type = 'private'
        AND (
            (
                SELECT COUNT(*)
                FROM comms_channel_participants cp
                WHERE cp.channel_id = comms_channels.id
                AND cp.user_id = ANY($1)
            ) = CARDINALITY($1)
            AND (
                SELECT COUNT(*)
                FROM comms_channel_participants
                WHERE channel_id = comms_channels.id
            ) = CARDINALITY($1)
        )
        "#,
        participants
    )
    .fetch_optional(db)
    .await
    .context("unable to get private channel")?;

    Ok(channel.map(|c| c.id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_get_existing_private_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let result =
            maybe_get_private_channel(&pool, &vec!["user1".to_string(), "user2".to_string()])
                .await?;

        assert_eq!(result, None);

        let result = maybe_get_private_channel(
            &pool,
            &vec![
                "user1".to_string(),
                "user3".to_string(),
                "user2".to_string(),
            ],
        )
        .await?;

        assert_eq!(
            result.unwrap(),
            Uuid::parse_str("11111111-1111-1111-1111-111111111111")?
        );

        let result = maybe_get_private_channel(
            &pool,
            &vec![
                "user1".to_string(),
                "user3".to_string(),
                "user4".to_string(),
                "user2".to_string(),
            ],
        )
        .await?;

        assert_eq!(result, None);

        Ok(())
    }
}
