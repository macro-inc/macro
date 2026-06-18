use anyhow::{Context, Result};
use channels::domain::models::{ChannelParticipant, Sender};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::Transaction;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(sqlx::Type, Debug)]
#[sqlx(rename_all = "lowercase")]
pub enum DbParticipantRole {
    Admin,
    Member,
    Owner,
}

impl From<DbParticipantRole> for channels::domain::models::ParticipantRole {
    fn from(role: DbParticipantRole) -> Self {
        match role {
            DbParticipantRole::Admin => Self::Admin,
            DbParticipantRole::Member => Self::Member,
            DbParticipantRole::Owner => Self::Owner,
        }
    }
}

// XXX: This is a shim until we correctly implement https://macro.com/app/task/019ed710-f261-7059-b890-5ade6e11f4cd
fn validate_participant_user_id(user_id: &str) -> Result<(), sqlx::Error> {
    Sender::parse_storage_str(user_id)
        .map(|_| ())
        .map_err(|err| sqlx::Error::Decode(Box::new(err)))
}

#[tracing::instrument(skip(tsx))]
pub async fn get_participants_tsx<'t>(
    tsx: &mut Transaction<'t, Postgres>,
    channel_id: &Uuid,
) -> Result<Vec<ChannelParticipant>, sqlx::Error> {
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
        validate_participant_user_id(&row.user_id)?;
        Ok(ChannelParticipant {
            channel_id: row.channel_id,
            user_id: row.user_id,
            role: row.role.into(),
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
) -> Result<Vec<ChannelParticipant>, sqlx::Error> {
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
        validate_participant_user_id(&row.user_id)?;
        Ok(ChannelParticipant {
            channel_id: row.channel_id,
            user_id: row.user_id,
            role: row.role.into(),
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
        SELECT DISTINCT id as "id!" FROM (
            SELECT m.sender_id AS id
            FROM comms_channel_participants cp
            JOIN comms_channels c ON c.id = cp.channel_id
            JOIN comms_messages m ON m.channel_id = c.id
            WHERE (m.id = $1 OR m.thread_id = $1) AND cp.left_at IS NULL
            UNION
            SELECT em.entity_id AS id
            FROM comms_entity_mentions em
            JOIN comms_messages m ON m.id::text = em.source_entity_id
            JOIN comms_channel_participants cp
              ON cp.channel_id = m.channel_id AND cp.user_id = em.entity_id
            WHERE (m.id = $1 OR m.thread_id = $1)
              AND em.source_entity_type = 'message'
              AND em.entity_type = 'user'
              AND cp.left_at IS NULL
        ) AS combined
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

        assert_eq!(participants.len(), 5);

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
        // user5 is mentioned in a thread-1 reply and is a participant of channel 1,
        // so they should be included via the mentions path even though they never
        // posted in this thread.
        assert!(
            participants.contains(&MacroUserIdStr::parse_from_str("macro|user5@test.com").unwrap())
        );

        // user6 is mentioned in a message that belongs to a different thread and
        // must not leak into this thread's participant set.
        assert!(
            !participants
                .contains(&MacroUserIdStr::parse_from_str("macro|user6@test.com").unwrap())
        );
        // The outsider is mentioned in a thread-1 message but is not a participant
        // of the channel, so the participation filter must exclude them.
        assert!(
            !participants
                .contains(&MacroUserIdStr::parse_from_str("macro|outsider@test.com").unwrap())
        );

        Ok(())
    }
}
