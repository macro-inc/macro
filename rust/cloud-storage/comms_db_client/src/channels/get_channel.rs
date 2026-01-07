use anyhow::{Context, Result};
#[allow(unused_imports)]
use model::comms::{Channel, ChannelType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

pub async fn get_channel(db: &Pool<Postgres>, channel_id: &Uuid) -> Result<Channel> {
    let channel = sqlx::query_as!(
        Channel,
        r#"
        SELECT
            id,
            name,
            channel_type AS "channel_type: ChannelType",
            org_id,
            created_at,
            updated_at,
            owner_id
        FROM comms_channels
        WHERE id = $1
        "#,
        channel_id
    )
    .fetch_one(db)
    .await
    .context("failed to get channel")?;

    Ok(channel)
}

/// Gets the channel name if present
pub async fn get_channel_name(db: &Pool<Postgres>, channel_id: &Uuid) -> Result<Option<String>> {
    let channel = sqlx::query!(
        r#"
        SELECT
            name
        FROM comms_channels
        WHERE id = $1
        "#,
        channel_id
    )
    .map(|row| row.name)
    .fetch_one(db)
    .await
    .context("failed to get channel")?;

    Ok(channel)
}
