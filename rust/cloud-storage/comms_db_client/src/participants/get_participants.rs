use anyhow::{Context, Result};
use model::comms::ChannelParticipant;
use model::comms::ParticipantRole;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn get_participants(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
) -> Result<Vec<ChannelParticipant>, sqlx::Error> {
    let participants = sqlx::query_as!(
        ChannelParticipant,
        r#"
        SELECT
            user_id,
            channel_id,
            joined_at,
            left_at,
            role as "role: ParticipantRole"
        FROM comms_channel_participants
        WHERE channel_id = $1
        ORDER BY joined_at DESC
        "#,
        channel_id
    )
    .fetch_all(db)
    .await?;

    Ok(participants)
}

/// Gets the participants (user ids) for a channel that need to be notified
pub async fn get_channel_participants_for_notification(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
) -> Result<Vec<String>> {
    let participants = sqlx::query!(
        r#"
        SELECT
            user_id
        FROM comms_channel_participants
        WHERE channel_id = $1
        "#,
        channel_id
    )
    .map(|participant| participant.user_id)
    .fetch_all(db)
    .await
    .context("unable to get messages")?;

    Ok(participants)
}

/// Gets the list of participants user ids who are part of a given thread
pub async fn get_channel_participants_for_thread_id(
    db: &Pool<Postgres>,
    thread_id: &Uuid,
) -> Result<Vec<String>> {
    let participants: Vec<String> = sqlx::query!(
        r#"
        SELECT DISTINCT(m.sender_id) as id
        FROM comms_channel_participants cp
        JOIN comms_channels c ON c.id = cp.channel_id
        JOIN comms_messages m ON m.channel_id = c.id 
        WHERE (m.id = $1 OR m.thread_id = $1) AND cp.left_at IS NULL
        "#,
        thread_id
    )
    .map(|participant| participant.id)
    .fetch_all(db)
    .await?;

    Ok(participants)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("threads"))
    )]
    async fn test_get_channel_participants_for_thread_id(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let thread_id = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
        let participants = get_channel_participants_for_thread_id(&pool, &thread_id).await?;

        assert_eq!(participants.len(), 4);

        assert!(participants.contains(&"user1".to_string()));
        assert!(participants.contains(&"user2".to_string()));
        assert!(participants.contains(&"user3".to_string()));
        assert!(participants.contains(&"user4".to_string()));

        Ok(())
    }
}
