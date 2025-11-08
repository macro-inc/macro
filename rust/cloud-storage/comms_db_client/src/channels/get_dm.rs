use anyhow::{Context, Result};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
struct ChannelId {
    id: Uuid,
}

/// Tries to fetch a channel with channel_type = direct_message and
/// where both user_id and recipient_id are participants of the channel
pub async fn maybe_get_dm(
    db: &Pool<Postgres>,
    user_id: &str,
    recipient_id: &str,
) -> Result<Option<Uuid>> {
    let channel = sqlx::query_as!(
        ChannelId,
        r#"
        SELECT id
        FROM comms_channels
        WHERE channel_type = 'direct_message'
        AND EXISTS (
            SELECT 1
            FROM comms_channel_participants cp
            WHERE cp.channel_id = comms_channels.id
            AND cp.user_id = $1
        )
        AND EXISTS (
            SELECT 1
            FROM comms_channel_participants cp
            WHERE cp.channel_id = comms_channels.id
            AND cp.user_id = $2
        )
        "#,
        user_id,
        recipient_id
    )
    .fetch_optional(db)
    .await
    .context("unable to get direct message channel")?;

    Ok(channel.map(|c| c.id))
}
