use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Deletes a channel given its channel_id
/// The user_id provided must be the owner of the channel
#[tracing::instrument(skip(db))]
pub async fn delete_channel(db: &Pool<Postgres>, channel_id: Uuid, user_id: &str) -> Result<()> {
    let result = sqlx::query!(
        r#"
        DELETE FROM comms_channels
        WHERE id = $1
        AND EXISTS (
            SELECT 1 FROM comms_channel_participants
            WHERE channel_id = $1
            AND user_id = $2
            AND role = 'owner'::comms_participant_role
        )
        "#,
        channel_id,
        user_id
    )
    .execute(db)
    .await
    .context("Failed to delete channel")?;

    if result.rows_affected() == 0 {
        anyhow::bail!(
            "channel not deleted, either it didn't exist or the user_id provided was not the owner"
        )
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::channels::get_channel;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_delete_channel(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let result = delete_channel(
            &pool,
            "11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "user1",
        )
        .await;

        assert!(result.is_ok());

        let channel = get_channel::get_channel(
            &pool,
            &"11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
        )
        .await;
        assert!(channel.is_err());
        Ok(())
    }
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_delete_channel_fail_when_not_owner(pool: Pool<Postgres>) -> Result<()> {
        let result = delete_channel(
            &pool,
            "11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "user2",
        )
        .await;

        assert!(result.is_err());

        let channel = get_channel::get_channel(
            &pool,
            &"11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
        )
        .await;
        assert!(channel.is_ok());
        Ok(())
    }
}
