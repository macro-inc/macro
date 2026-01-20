use anyhow::{Context, Result};
use doppleganger::Doppleganger;
use doppleganger::Mirror;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::comms::ChannelId;
use sqlx::Transaction;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(sqlx::Type, Doppleganger, Debug)]
#[dg(forward = models_comms::channel::ParticipantRole)]
#[sqlx(rename_all = "lowercase")]
pub enum DbParticipantRole {
    Admin,
    Member,
    Owner,
}

#[tracing::instrument(skip(tsx))]
pub async fn get_participants_tsx<'t>(
    tsx: &mut Transaction<'t, Postgres>,
    channel_id: &Uuid,
) -> Result<Vec<models_comms::channel::ChannelParticipant>, sqlx::Error> {
    let participants = sqlx::query!(
        r#"
        SELECT
            user_id,
            channel_id,
            joined_at,
            left_at,
            role as "role: DbParticipantRole"
        FROM comms_channel_participants
        WHERE channel_id = $1
        ORDER BY joined_at DESC
        "#,
        channel_id
    )
    .try_map(|row| {
        Ok(models_comms::channel::ChannelParticipant {
            channel_id: ChannelId(row.channel_id),
            user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&row.user_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
            role: DbParticipantRole::mirror(row.role),
            joined_at: row.joined_at,
            left_at: row.left_at,
        })
    })
    .fetch_all(tsx.as_mut())
    .await?;

    Ok(participants)
}

#[tracing::instrument(skip(db))]
pub async fn get_participants(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
) -> Result<Vec<models_comms::channel::ChannelParticipant>, sqlx::Error> {
    let participants = sqlx::query!(
        r#"
        SELECT
            user_id,
            channel_id,
            joined_at,
            left_at,
            role as "role: DbParticipantRole"
        FROM comms_channel_participants
        WHERE channel_id = $1
        ORDER BY joined_at DESC
        "#,
        channel_id
    )
    .try_map(|row| {
        Ok(models_comms::channel::ChannelParticipant {
            channel_id: ChannelId(row.channel_id),
            user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&row.user_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
            role: DbParticipantRole::mirror(row.role),
            joined_at: row.joined_at,
            left_at: row.left_at,
        })
    })
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
) -> Result<Vec<MacroUserIdStr<'static>>> {
    let participants: Vec<_> = sqlx::query!(
        r#"
        SELECT DISTINCT(m.sender_id) as id
        FROM comms_channel_participants cp
        JOIN comms_channels c ON c.id = cp.channel_id
        JOIN comms_messages m ON m.channel_id = c.id 
        WHERE (m.id = $1 OR m.thread_id = $1) AND cp.left_at IS NULL
        "#,
        thread_id
    )
    .try_map(|participant| {
        Ok(MacroUserIdStr::parse_from_str(&participant.id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned())
    })
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

        assert!(
            participants.contains(&MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap())
        );
        assert!(
            participants.contains(&MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap())
        );
        assert!(
            participants.contains(&MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap())
        );
        assert!(
            participants.contains(&MacroUserIdStr::parse_from_str("macro|user4@test.com").unwrap())
        );

        Ok(())
    }
}
