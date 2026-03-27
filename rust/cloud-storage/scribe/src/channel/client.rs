use ai_format::insight_context_log::InsightContextLog;
use ai_format::util::Indent;
use anyhow::Error;
use models_comms::channel::ChannelMetadata;
use sqlx::{Pool, Postgres};
use std::fmt::Debug;
use uuid::Uuid;

#[derive(Clone)]
pub struct ChannelClient {
    db: Pool<Postgres>,
}

impl ChannelClient {
    /// Create a new ChannelClient with a database pool for direct DB operations
    pub fn new(db: Pool<Postgres>) -> Self {
        Self { db }
    }

    /// Get channel metadata (name and type) by channel ID
    #[tracing::instrument(skip(self), err)]
    pub async fn get_channel_metadata(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
    ) -> Result<ChannelMetadata, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let channel =
            comms_db_client::channels::get_channel::get_channel(&self.db, &channel_id).await?;

        Ok(ChannelMetadata {
            name: channel.name.unwrap_or_default(),
            channel_type: match channel.channel_type {
                model::comms::ChannelType::Public => models_comms::channel::ChannelType::Public,
                model::comms::ChannelType::Organization => {
                    models_comms::channel::ChannelType::Organization
                }
                model::comms::ChannelType::Private => models_comms::channel::ChannelType::Private,
                model::comms::ChannelType::DirectMessage => {
                    models_comms::channel::ChannelType::DirectMessage
                }
                model::comms::ChannelType::Team => models_comms::channel::ChannelType::Team,
            },
        })
    }

    /// Get channel transcript (message history) by channel ID
    #[tracing::instrument(skip(self), err)]
    pub async fn get_channel_transcript(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<String, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let transcript = format_channel_transcript(&self.db, &channel_id, since, limit).await?;
        Ok(transcript)
    }

    /// Get messages with context around a specific message
    /// Returns formatted conversation with messages before and after the target message
    #[tracing::instrument(skip(self), err)]
    pub async fn get_message_with_context(
        &self,
        message_id: impl TryInto<Uuid> + Debug,
        before: i64,
        after: i64,
    ) -> Result<String, Error> {
        let message_id = message_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let db_messages =
            comms_db_client::messages::read_message_with_context::get_messages_with_context(
                &self.db,
                &message_id,
                before,
                after,
            )
            .await?;

        // Format messages using InsightContextLog
        let formatted_messages = db_messages
            .iter()
            .map(|msg| {
                InsightContextLog {
                    name: "message".to_string(),
                    metadata: vec![
                        ("message_id".to_string(), msg.id.to_string()),
                        ("sender_id".to_string(), msg.sender_id.to_string()),
                        ("created_at".to_string(), msg.created_at.to_rfc3339()),
                    ],
                    content: msg.content.clone(),
                }
                .to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");

        let formatted_text = InsightContextLog {
            name: "conversation".to_string(),
            metadata: vec![],
            content: Indent(4, formatted_messages),
        }
        .to_string();

        Ok(formatted_text)
    }
}

/// Format channel messages into a transcript string
/// This matches the logic in comms_service/src/api/channels/get_channel_transcript.rs
async fn format_channel_transcript(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    since: Option<chrono::DateTime<chrono::Utc>>,
    limit: Option<i64>,
) -> anyhow::Result<String> {
    let messages =
        comms_db_client::messages::get_messages::get_messages(db, channel_id, since, limit).await?;

    let formatted_messages = messages
        .iter()
        .map(|msg| {
            InsightContextLog {
                name: "message".to_string(),
                metadata: vec![
                    ("sender_id".to_string(), msg.sender_id.to_string()),
                    ("created_at".to_string(), msg.created_at.to_rfc3339()),
                ],
                content: msg.content.clone(),
            }
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");

    let formatted_text = InsightContextLog {
        name: "conversation".to_string(),
        metadata: vec![],
        content: Indent(4, formatted_messages),
    }
    .to_string();

    let prompt = "The following conversation is limited to the last 1000 messages. Ignore all formatting and do not show the user the formatted conversation.";
    let formatted_messages = format!("{}\n\n{}", prompt, formatted_text);

    Ok(formatted_messages)
}
