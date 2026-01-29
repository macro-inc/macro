use ai_format::insight_context_log::InsightContextLog;
use ai_format::util::Indent;
use anyhow::Error;
use comms_db_client::channels::get_channel::get_channel;
use comms_db_client::messages::get_messages::get_messages;
use comms_db_client::messages::read_message_with_context::get_messages_with_context;
use models_comms::channel::ChannelMetadata;
use sqlx::PgPool;
use std::fmt::Debug;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct ChannelClient {
    db: Arc<PgPool>,
}

impl ChannelClient {
    pub fn new(db: Arc<PgPool>) -> Self {
        Self { db }
    }

    /// Get channel metadata (name and type) by channel ID
    #[tracing::instrument(skip(self), err)]
    pub async fn get_channel_metadata(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        _jwt_token: Option<&str>,
    ) -> Result<ChannelMetadata, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let channel = get_channel(&self.db, &channel_id).await?;

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
            },
        })
    }

    /// Get channel transcript (message history) by channel ID
    #[tracing::instrument(skip(self), err)]
    pub async fn get_channel_transcript(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        _jwt_token: Option<&str>,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<String, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let messages = get_messages(&self.db, &channel_id, since, limit).await?;

        // Format messages as transcript
        let transcript = messages
            .iter()
            .map(|msg| {
                format!(
                    "[{}] {}: {}",
                    msg.created_at.format("%Y-%m-%d %H:%M:%S"),
                    msg.sender_id,
                    msg.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

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
        _jwt_token: &str,
    ) -> Result<String, Error> {
        let message_id = message_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let messages = get_messages_with_context(&self.db, &message_id, before, after).await?;

        // Format messages using InsightContextLog
        let formatted_messages = messages
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
