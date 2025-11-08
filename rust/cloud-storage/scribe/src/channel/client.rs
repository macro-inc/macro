use ai_format::{Indent, InsightContextLog};
use anyhow::Error;
use comms_service_client::CommsServiceClient;
use models_comms::ChannelMetadata;
use std::fmt::Debug;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct ChannelClient {
    inner: Arc<CommsServiceClient>,
}

impl ChannelClient {
    pub fn new(client: Arc<CommsServiceClient>) -> Self {
        Self { inner: client }
    }
    /// Get channel metadata (name and type) by channel ID
    /// Uses external authenticated endpoint if jwt_token is provided, otherwise uses internal endpoint
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channel_metadata(
        &self,
        channel_id: impl TryInto<Uuid> + Debug,
        jwt_token: Option<&str>,
    ) -> Result<ChannelMetadata, Error> {
        let channel_id = channel_id
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid uuid"))?;

        let response = match jwt_token {
            Some(token) => self
                .inner
                .get_channel_metadata_external(&channel_id, token)
                .await
                .map_err(Error::from)?,
            None => self
                .inner
                .get_channel_metadata_internal(&channel_id, None)
                .await
                .map_err(Error::from)?,
        };
        Ok(ChannelMetadata::from((
            response.channel_name,
            response.channel_type,
        )))
    }

    /// Get channel transcript (message history) by channel ID
    /// Uses external authenticated endpoint if jwt_token is provided, otherwise uses internal endpoint
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
        let response = match jwt_token {
            Some(token) => self
                .inner
                .get_channel_transcript_external(&channel_id, token, since, limit)
                .await
                .map_err(Error::from)?,
            None => self
                .inner
                .get_channel_transcript_internal(&channel_id, since, limit)
                .await
                .map_err(Error::from)?,
        };
        Ok(response.transcript)
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
                        ("sender_id".to_string(), msg.sender_id.clone()),
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
            content: Indent(formatted_messages, 4),
        }
        .to_string();

        Ok(formatted_text)
    }
}
