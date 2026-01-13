use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use model::comms::ChannelType;
use model::comms::{GetChannelsHistoryRequest, GetChannelsHistoryResponse};
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

/// Channel type from API response
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
}

/// Participant role from API response
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiParticipantRole {
    Owner,
    Admin,
    Member,
}

/// Channel participant from API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiChannelParticipant {
    pub channel_id: Uuid,
    pub user_id: String,
    pub role: ApiParticipantRole,
    pub joined_at: chrono::DateTime<chrono::Utc>,
    pub left_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Channel message from API response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiChannelMessage {
    pub message_id: Uuid,
    pub thread_id: Option<Uuid>,
    pub sender_id: String,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub mentions: Vec<String>,
}

/// Channel with latest message from GET /channels response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiChannelWithLatest {
    /// Channel ID
    pub id: Uuid,
    /// Channel name (may be None for DMs)
    pub name: Option<String>,
    /// Channel type
    pub channel_type: ApiChannelType,
    /// Organization ID if applicable
    pub org_id: Option<u32>,
    /// When the channel was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// When the channel was last updated
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// Owner user ID
    pub owner_id: String,
    /// Channel participants
    pub participants: Vec<ApiChannelParticipant>,
    /// Latest message in the channel
    pub latest_message: Option<ApiChannelMessage>,
    /// Latest non-thread message
    pub latest_non_thread_message: Option<ApiChannelMessage>,
    /// When the user last viewed the channel
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the user last interacted with the channel
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Frecency score for sorting
    pub frecency_score: Option<f64>,
}

impl CommsServiceClient {
    // External routes - require JWT authentication and perform permission checks

    /// Get all channels the user has access to using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_channels_external(
        &self,
        jwt_token: &str,
    ) -> Result<Vec<ApiChannelWithLatest>, ClientError> {
        let url = format!("{}/channels", self.url);
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
                    e.to_string()
                ))
            })?;

        Ok(result)
    }

    /// Get channel metadata using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_channel_metadata_external(
        &self,
        channel_id: &Uuid,
        jwt_token: &str,
    ) -> Result<ChannelMetadataResponse, ClientError> {
        let url = format!("{}/channels/{}/metadata", self.url, channel_id);
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
                    e.to_string()
                ))
            })?;

        Ok(result)
    }

    /// Get channel transcript using external authenticated endpoint
    #[tracing::instrument(skip(self, jwt_token))]
    pub async fn get_channel_transcript_external(
        &self,
        channel_id: &Uuid,
        jwt_token: &str,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<ChannelTranscriptResponse, ClientError> {
        let mut url = format!("{}/channels/{}/transcript", self.url, channel_id);
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
                    e.to_string()
                ))
            })?;

        Ok(result)
    }

    // Internal routes - no authentication, used for service-to-service communication

    /// Get channel metadata using internal endpoint
    #[tracing::instrument(skip(self))]
    pub async fn get_channel_metadata_internal(
        &self,
        channel_id: &Uuid,
        user_id: Option<&str>,
    ) -> Result<ChannelMetadataResponse, ClientError> {
        let mut url = format!("{}/internal/get_channel_metadata/{}", self.url, channel_id);
        if let Some(user_id) = user_id {
            url = format!("{}?user_id={}", url, urlencoding::encode(user_id));
        }
        let response = self.client.get(url).send().await.map_client_error().await?;

        let result = response
            .json::<ChannelMetadataResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channel_metadata_internal: {}",
                    e.to_string()
                ))
            })?;

        Ok(result)
    }

    /// Get channel transcript using internal endpoint
    #[tracing::instrument(skip(self))]
    pub async fn get_channel_transcript_internal(
        &self,
        channel_id: &Uuid,
        since: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
    ) -> Result<ChannelTranscriptResponse, ClientError> {
        let mut url = format!(
            "{}/internal/get_channel_transcript/{}",
            self.url, channel_id
        );
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
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<ChannelTranscriptResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channel_transcript_internal: {}",
                    e.to_string()
                ))
            })?;

        Ok(result)
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_channels_history(
        &self,
        request: GetChannelsHistoryRequest,
    ) -> Result<GetChannelsHistoryResponse, ClientError> {
        let response = self
            .client
            .post(format!("{}/internal/get_channels_history", self.url))
            .json(&request)
            .send()
            .await
            .map_client_error()
            .await?;

        let result = response
            .json::<GetChannelsHistoryResponse>()
            .await
            .map_err(|e| {
                ClientError::Generic(anyhow::anyhow!(
                    "unable to parse response from get_channels_history: {}",
                    e.to_string()
                ))
            })?;

        Ok(result)
    }
}
