use model::comms::{ChannelMessage, ChannelType, GetChannelMessageResponse};
use uuid::Uuid;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChannelMessageInfo {
    pub channel_id: Uuid,
    pub name: Option<String>,
    pub channel_type: ChannelType,
    pub org_id: Option<i64>,
    pub message_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub sender_id: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Gets a channel message by channel id and message id
/// This is used to get content necessary to populate the channel message for search
#[tracing::instrument(skip(db))]
pub async fn get_channel_message_by_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &Uuid,
    message_id: &Uuid,
) -> anyhow::Result<GetChannelMessageResponse> {
    let mentions: Vec<String> = sqlx::query!(
        r#"
        SELECT
            entity_type,
            entity_id
        FROM
            comms_entity_mentions
        WHERE
            source_entity_id = $1 AND source_entity_type = 'message'
        "#,
        &message_id.to_string(),
    )
    .map(|row| format!("{}:{}", row.entity_type, row.entity_id))
    .fetch_all(db)
    .await?;

    let channel_message_info = sqlx::query_as!(
        ChannelMessageInfo,
        r#"
        SELECT
            c.id as "channel_id",
            c.name as "name",
            c.channel_type AS "channel_type: ChannelType",
            c.org_id as "org_id",
            m.id as "message_id",
            m.thread_id as "thread_id",
            m.sender_id as "sender_id",
            m.content as "content",
            m.created_at as "created_at",
            m.updated_at as "updated_at",
            m.deleted_at::timestamptz as "deleted_at"
        FROM
            comms_messages m
        JOIN
            comms_channels c on c."id" = m."channel_id"
        WHERE
            m.id = $1
            AND c.id = $2
        "#,
        message_id,
        channel_id,
    )
    .fetch_one(db)
    .await?;

    Ok(GetChannelMessageResponse {
        channel_id: channel_message_info.channel_id,
        name: channel_message_info.name,
        channel_type: channel_message_info.channel_type,
        org_id: channel_message_info.org_id,
        channel_message: ChannelMessage {
            message_id: channel_message_info.message_id,
            thread_id: channel_message_info.thread_id,
            sender_id: channel_message_info.sender_id,
            content: channel_message_info.content,
            created_at: channel_message_info.created_at,
            updated_at: channel_message_info.updated_at,
            deleted_at: channel_message_info.deleted_at,
            mentions,
        },
    })
}
