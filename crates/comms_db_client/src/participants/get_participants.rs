use anyhow::{Context, Result};
use channels::domain::models::{ChannelParticipant, ChannelSender};
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
    ChannelSender::parse_from_str(user_id)
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
