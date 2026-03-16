use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use model::comms::{ChannelMessage, ChannelParticipant, ChannelType};
use models_comms::channel::{ChannelId, OrganizationId};
use serde::{Deserialize, Serialize};
use urlencoding;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelMetadataResponse {
    pub channel_name: String,
    pub channel_type: ChannelType,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelTranscriptResponse {
    pub transcript: String,
}

/// Channel with latest message from GET /channels response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiChannelWithLatest {
    /// Channel ID
    pub id: ChannelId,
    /// Channel name (may be None for DMs)
    pub name: Option<String>,
    /// Channel type
    pub channel_type: ChannelType,
    /// Organization ID if applicable
    pub org_id: Option<OrganizationId>,
    /// When the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// When the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Owner user ID
    pub owner_id: String,
    /// Channel participants
    pub participants: Vec<ChannelParticipant>,
    /// Latest message in the channel
    pub latest_message: Option<ChannelMessage>,
    /// Latest non-thread message
    pub latest_non_thread_message: Option<ChannelMessage>,
    /// When the user last viewed the channel
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the user last interacted with the channel
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Frecency score for sorting
    pub frecency_score: Option<f64>,
}

impl CommsServiceClient {
    /// Get all channels the user has access to using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channels_external(
        &self,
        jwt_token: &str,
    ) -> Result<Vec<ApiChannelWithLatest>, ClientError> {
        let url = format!("{}/comms/channels", self.url);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<Vec<ApiChannelWithLatest>>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channels_external: {}",
                    e
                ))
            })?;

        Ok(result)
    }

    /// Get channel metadata using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channel_metadata_external(
        &self,
        channel_id: &Uuid,
        jwt_token: &str,
    ) -> Result<ChannelMetadataResponse, ClientError> {
        let url = format!("{}/comms/channels/{}/metadata", self.url, channel_id);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<ChannelMetadataResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channel_metadata_external: {}",
                    e
                ))
            })?;

        Ok(result)
    }

    /// Get channel transcript using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token), err)]
    pub async fn get_channel_transcript_external(
        &self,
        channel_id: &Uuid,
        jwt_token: &str,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<ChannelTranscriptResponse, ClientError> {
        let mut url = format!("{}/comms/channels/{}/transcript", self.url, channel_id);
        let mut query_params = vec![];
        if let Some(since) = since {
            query_params.push(format!(
                "since={}",
                urlencoding::encode(&since.to_rfc3339())
            ));
        }
        if let Some(limit) = limit {
            query_params.push(format!("limit={}", limit));
        }
        if !query_params.is_empty() {
            url = format!("{}?{}", url, query_params.join("&"));
        }

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt_token))
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<ChannelTranscriptResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channel_transcript_external: {}",
                    e
                ))
            })?;

        Ok(result)
    }
}
