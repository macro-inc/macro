use ai_format::insight_context_log::InsightContextLog;
use ai_format::util::Indent;
use anyhow::Error;
use comms_service_client::CommsServiceClient;
use comms_service_client::channels::{ApiChannelWithLatest, ChannelMetadataResponse};
use models_comms::channel::ChannelMetadata;
use sqlx::{Pool, Postgres};
use std::fmt::Debug;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct ChannelClient {
    inner: Arc<CommsServiceClient>,
    db: Pool<Postgres>,
}

impl ChannelClient {
    /// Create a new ChannelClient with a database pool for internal (non-JWT) operations
    pub fn new_with_db(client: Arc<CommsServiceClient>, db: Pool<Postgres>) -> Self {
        Self { inner: client, db }
    }

    /// List all channels the user has access to
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn list_channels(&self, jwt_token: &str) -> Result<Vec<ApiChannelWithLatest>, Error> {
        let channels = self
            .inner
            .get_channels_external(jwt_token)
            .await
            .map_err(Error::from)?;
        Ok(channels)
    }

    /// Get channel metadata (name and type) by channel ID
    /// Uses external authenticated endpoint if jwt_token is provided, otherwise uses direct DB access
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channel_metadata(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        jwt_token: Option<&str>,
    ) -> Result<ChannelMetadata, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let channel = match jwt_token {
            Some(token) => self
                .inner
                .get_channel_metadata_external(&channel_id, token)
                .await
                .map_err(Error::from)?,
            None => {
                let channel =
                    comms_db_client::channels::get_channel::get_channel(&self.db, &channel_id)
                        .await?;

                ChannelMetadataResponse {
                    channel_name: channel.name.unwrap_or_default(),
                    channel_type: channel.channel_type,
                }
            }
        };

        Ok(ChannelMetadata {
            name: channel.channel_name,
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
    /// Uses external authenticated endpoint if jwt_token is provided, otherwise uses direct DB access
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channel_transcript(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        jwt_token: Option<&str>,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<String, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        match jwt_token {
            Some(token) => {
                let response = self
                    .inner
                    .get_channel_transcript_external(&channel_id, token, since, limit)
                    .await
                    .map_err(Error::from)?;
                Ok(response.transcript)
            }
            None => {
                // Use direct DB access for internal calls
                let transcript =
                    format_channel_transcript(&self.db, &channel_id, since, limit).await?;
                Ok(transcript)
            }
        }
    }

    /// Get messages with context around a specific message
    /// Returns formatted conversation with messages before and after the target message
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_message_with_context(
        &self,
        message_id: impl TryInto<Uuid> + Debug,
        before: i64,
        after: i64,
        jwt_token: &str,
    ) -> Result<String, Error> {
        let message_id = message_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let response = self
            .inner
            .get_message_with_context(&message_id, before, after, jwt_token)
            .await
            .map_err(Error::from)?;

        // Format messages using InsightContextLog
        let formatted_messages = response
            .messages
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
