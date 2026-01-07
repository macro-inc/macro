use super::CommsServiceClient;
use crate::error::{ClientError, ResponseExt};
use model::comms::{GetChannelsHistoryRequest, GetChannelsHistoryResponse};
use models_comms::ChannelType;
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

impl CommsServiceClient {
    // External routes - require JWT authentication and perform permission checks

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
