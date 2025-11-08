use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct PatchChannelOptions {
    pub channel_name: Option<String>,
}

#[tracing::instrument(skip(db))]
pub async fn patch_channel(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    user_id: &str,
    options: PatchChannelOptions,
) -> Result<()> {
    let authorized = sqlx::query!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM comms_channel_participants
            WHERE channel_id = $1
            AND user_id = $2
            AND role IN ('admin'::comms_participant_role, 'owner'::comms_participant_role)
        ) as "is_authorized!"
        "#,
        channel_id,
        user_id
    )
    .fetch_one(db)
    .await
    .context("Failed to check user authorization")?
    .is_authorized;

    if !authorized {
        anyhow::bail!(
            "User is not authorized to perform this action, to patch a channel you must be an admin or owner"
        );
    }

    let mut transaction = db.begin().await?;

    if let Some(channel_name) = options.channel_name {
        sqlx::query!(
            r#"
                UPDATE comms_channels
                SET name = $1
                WHERE id = $2
                "#,
            channel_name,
            channel_id
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    return Ok(());
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
    async fn test_patch_channel(pool: Pool<Postgres>) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let result = patch_channel(
            &pool,
            &"11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "user1",
            PatchChannelOptions {
                channel_name: Some("new channel name".to_string()),
            },
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

        assert!(channel.is_ok());

        assert_eq!(channel.unwrap().name, Some("new channel name".to_string()));

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_patch_channnel_unauthorized(pool: Pool<Postgres>) -> Result<()> {
        let result = patch_channel(
            &pool,
            &"11111111-1111-1111-1111-111111111111"
                .parse::<Uuid>()
                .unwrap(),
            "user2",
            PatchChannelOptions {
                channel_name: Some("new channel name".to_string()),
            },
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

        assert_eq!(channel.unwrap().name, Some("private 1 ".to_string()));

        Ok(())
    }
}
