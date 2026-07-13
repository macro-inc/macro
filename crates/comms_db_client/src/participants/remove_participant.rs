use anyhow::{Context, Result};
use uuid::Uuid;

pub struct RemoveParticipantOptions<'a> {
    pub channel_id: &'a Uuid,
    pub user_id: &'a str,
}

pub async fn remove_participant<'e, 'a, E>(
    executor: E,
    options: RemoveParticipantOptions<'a>,
) -> Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
            DELETE FROM "comms_channel_participants"
            WHERE channel_id = $1 AND user_id = $2
        "#,
        options.channel_id,
        options.user_id,
    )
    .execute(executor)
    .await
    .context("unable to remove participant from channel")?;

    Ok(())
}
