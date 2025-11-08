use anyhow::{Context, Result};
use uuid::Uuid;

use model::comms::ParticipantRole;

pub struct AddParticipantOptions<'a> {
    pub channel_id: &'a Uuid,
    pub user_id: &'a str,
    pub participant_role: Option<ParticipantRole>,
}

pub async fn add_participant<'e, 'a, E>(
    executor: E,
    options: AddParticipantOptions<'a>,
) -> Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role)
            VALUES ($1, $2, $3)
        "#,
        options.channel_id,
        options.user_id,
        options.participant_role.unwrap_or_default() as ParticipantRole
    )
    .execute(executor)
    .await
    .context("unable to add participant to channel")?;

    Ok(())
}
