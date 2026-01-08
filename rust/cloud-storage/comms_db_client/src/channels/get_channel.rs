use anyhow::{Context, Result};
use macro_user_id::cowlike::CowLike;
use model::comms::{Channel, ChannelId, ChannelType, OrganizationId};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

pub async fn get_channel(db: &Pool<Postgres>, channel_id: &Uuid) -> Result<Channel> {
    let channel = sqlx::query!(
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
    .try_map(|row| {
        Ok(Channel {
            id: ChannelId(row.id),
            name: row.name,
            channel_type: row.channel_type,
            org_id: row.org_id.map(|id| OrganizationId(id as u32)),
            created_at: row.created_at,
            updated_at: row.updated_at,
            owner_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&row.owner_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
        })
    })
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
