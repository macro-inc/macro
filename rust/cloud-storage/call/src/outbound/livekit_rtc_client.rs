//! LiveKit adapter for the [`CallRtcClient`] port.
//!
//! Wraps the `livekit-api` crate to provide room management, token generation,
//! egress recording, and webhook validation.

use livekit_api::access_token::{AccessToken, TokenVerifier, VideoGrants};
use livekit_api::services::agent_dispatch::AgentDispatchClient;
use livekit_api::services::egress::{EgressClient, EgressOutput, RoomCompositeOptions};
use livekit_api::services::room::{CreateRoomOptions, RoomClient};
use livekit_api::webhooks::WebhookReceiver;
use livekit_protocol::{
    CreateAgentDispatchRequest, EncodedFileOutput, S3Upload, encoded_file_output,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{CallError, CallWebhookEvent, EgressS3Config};
use crate::domain::ports::CallRtcClient;

/// LiveKit implementation of [`CallRtcClient`].
pub struct LivekitRtcClient {
    room_client: RoomClient,
    egress_client: EgressClient,
    agent_dispatch_client: AgentDispatchClient,
    webhook_receiver: WebhookReceiver,
    api_key: String,
    api_secret: String,
    /// If set, the named agent is dispatched to each new room for transcription.
    transcription_agent_name: Option<String>,
}

impl LivekitRtcClient {
    /// Create a new LiveKit RTC client.
    ///
    /// # Arguments
    /// * `server_url` - LiveKit server URL (e.g. `https://my-livekit.example.com`)
    /// * `api_key` - LiveKit API key
    /// * `api_secret` - LiveKit API secret
    /// * `transcription_agent_name` - If set, this agent is dispatched to new rooms for STT
    pub fn new(
        server_url: &str,
        api_key: impl Into<String>,
        api_secret: impl Into<String>,
        transcription_agent_name: Option<String>,
    ) -> Self {
        let api_key = api_key.into();
        let api_secret = api_secret.into();
        // Twirp RPC requires HTTP(S), not WebSocket. Convert wss:// → https://
        // and ws:// → http:// so the same env var works for both client SDK and
        // server-side API calls.
        let http_url = server_url
            .replace("wss://", "https://")
            .replace("ws://", "http://");
        let room_client = RoomClient::with_api_key(&http_url, &api_key, &api_secret);
        let egress_client = EgressClient::with_api_key(&http_url, &api_key, &api_secret);
        let agent_dispatch_client =
            AgentDispatchClient::with_api_key(&http_url, &api_key, &api_secret);
        let verifier = TokenVerifier::with_api_key(&api_key, &api_secret);
        let webhook_receiver = WebhookReceiver::new(verifier);
        Self {
            room_client,
            egress_client,
            agent_dispatch_client,
            webhook_receiver,
            api_key,
            api_secret,
            transcription_agent_name,
        }
    }
}

impl CallRtcClient for LivekitRtcClient {
    #[tracing::instrument(err, skip(self))]
    async fn create_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.room_client
            .create_room(room_name, CreateRoomOptions::default())
            .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.room_client.delete_room(room_name).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn generate_token(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'_>,
    ) -> anyhow::Result<String> {
        let token = AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(participant_identity.as_ref())
            .with_grants(VideoGrants {
                room_join: true,
                room: room_name.to_string(),
                can_publish: true,
                can_subscribe: true,
                can_publish_data: true,
                ..Default::default()
            })
            .to_jwt()?;
        Ok(token)
    }

    #[tracing::instrument(err, skip(self))]
    async fn remove_participant(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'_>,
    ) -> anyhow::Result<()> {
        self.room_client
            .remove_participant(room_name, participant_identity.as_ref())
            .await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self, s3_config))]
    async fn start_room_composite_egress(
        &self,
        room_name: &str,
        s3_config: &EgressS3Config,
    ) -> anyhow::Result<String> {
        let output = EgressOutput::File(EncodedFileOutput {
            filepath: format!("calls/{room_name}/{{time}}"),
            output: Some(encoded_file_output::Output::S3(S3Upload {
                bucket: s3_config.bucket.clone(),
                region: s3_config.region.clone(),
                access_key: s3_config.access_key.clone(),
                secret: s3_config.secret.clone(),
                ..Default::default()
            })),
            ..Default::default()
        });

        let info = self
            .egress_client
            .start_room_composite_egress(room_name, vec![output], RoomCompositeOptions::default())
            .await?;

        Ok(info.egress_id)
    }

    #[tracing::instrument(err, skip(self))]
    async fn stop_egress(&self, egress_id: &str) -> anyhow::Result<()> {
        self.egress_client.stop_egress(egress_id).await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn dispatch_transcription_agent(&self, room_name: &str) -> anyhow::Result<()> {
        let Some(agent_name) = &self.transcription_agent_name else {
            return Ok(());
        };

        self.agent_dispatch_client
            .create_dispatch(CreateAgentDispatchRequest {
                agent_name: agent_name.clone(),
                room: room_name.to_owned(),
                ..Default::default()
            })
            .await?;

        tracing::info!(room_name, agent_name, "dispatched transcription agent");
        Ok(())
    }

    fn receive_webhook(&self, body: &str, auth_token: &str) -> Result<CallWebhookEvent, CallError> {
        let event = self
            .webhook_receiver
            .receive(body, auth_token)
            .map_err(|e| {
                tracing::warn!(error=?e, "webhook signature validation failed");
                CallError::Auth
            })?;

        // Extract file URL from egress info if available.
        let (egress_id, file_url) = match &event.egress_info {
            Some(info) => {
                let url = info.file_results.first().map(|f| f.location.clone());
                let id = if info.egress_id.is_empty() {
                    None
                } else {
                    Some(info.egress_id.clone())
                };
                (id, url)
            }
            None => (None, None),
        };

        Ok(CallWebhookEvent {
            event: event.event,
            id: event.id,
            room_name: event.room.map(|r| r.name),
            participant_identity: event
                .participant
                .and_then(|p| {
                    // The transcription agent joins with its agent name as the
                    // identity, which is not a MacroUserId — short-circuit so
                    // join/leave events for the agent don't fail parsing.
                    if Some(p.identity.as_str()) == self.transcription_agent_name.as_deref() {
                        None
                    } else {
                        Some(MacroUserIdStr::parse_from_str(&p.identity).map(CowLike::into_owned))
                    }
                })
                .transpose()
                .map_err(anyhow::Error::from)?,
            egress_id,
            file_url,
            created_at: event.created_at,
        })
    }
}
