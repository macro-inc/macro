//! LiveKit adapter for the [`CallRtcClient`] port.
//!
//! Wraps the `livekit-api` crate to provide room management, token generation,
//! egress recording, and webhook validation.

#[cfg(test)]
mod test;

use futures::future;
use livekit_api::access_token::{AccessToken, TokenVerifier, VideoGrants};
use livekit_api::services::agent_dispatch::AgentDispatchClient;
use livekit_api::services::egress::{EgressClient, EgressOutput, RoomCompositeOptions, encoding};
use livekit_api::services::room::{CreateRoomOptions, RoomClient};
use livekit_api::webhooks::WebhookReceiver;
use livekit_protocol::{
    AudioCodec, CreateAgentDispatchRequest, EncodedFileOutput, EncodedFileType, S3Upload,
    VideoCodec, encoded_file_output,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::apple::VoipPushPayload;

use crate::domain::models::{
    CallError, CallWebhookEvent, EgressS3Config, VerifiedRingToken, VoipPushPayloadRequest,
};
use crate::domain::ports::CallRtcClient;

const VOIP_TOKEN_MINT_CONCURRENCY: usize = 16;

/// LiveKit implementation of [`CallRtcClient`].
pub struct LivekitRtcClient {
    room_client: RoomClient,
    egress_client: EgressClient,
    agent_dispatch_client: AgentDispatchClient,
    webhook_receiver: WebhookReceiver,
    token_verifier: TokenVerifier,
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
        let token_verifier = TokenVerifier::with_api_key(&api_key, &api_secret);
        let webhook_receiver = WebhookReceiver::new(token_verifier.clone());
        Self {
            room_client,
            egress_client,
            agent_dispatch_client,
            webhook_receiver,
            token_verifier,
            api_key,
            api_secret,
            transcription_agent_name,
        }
    }
}

struct RoomCompositeEgressRequest {
    room_name: String,
    outputs: Vec<EgressOutput>,
    options: RoomCompositeOptions,
}

fn build_room_composite_egress_request(
    room_name: &str,
    s3_config: &EgressS3Config,
) -> RoomCompositeEgressRequest {
    let output = EgressOutput::File(EncodedFileOutput {
        file_type: EncodedFileType::Mp4 as i32,
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

    let options = RoomCompositeOptions {
        encoding: encoding::EncodingOptions {
            audio_codec: AudioCodec::Aac,
            video_codec: VideoCodec::H264Main,
            ..Default::default()
        },
        ..Default::default()
    };

    RoomCompositeEgressRequest {
        room_name: room_name.to_owned(),
        outputs: vec![output],
        options,
    }
}

impl CallRtcClient for LivekitRtcClient {
    #[tracing::instrument(err, skip(self))]
    async fn create_room(&self, room_name: &str) -> anyhow::Result<()> {
        self.room_client
            .create_room(
                room_name,
                CreateRoomOptions {
                    empty_timeout: 60,
                    ..Default::default()
                },
            )
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
        // Pinned so VoIP-delivered tokens survive push delay and lock-screen ringing.
        // TODO(call-phase-2): add token refresh before supporting calls over 6h.
        let token = AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(participant_identity.as_ref())
            .with_ttl(std::time::Duration::from_secs(6 * 3600))
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

    #[tracing::instrument(
        skip(self, request),
        fields(
            recipient_count = request.recipients.len(),
            room_name = request.room_name,
            call_id = %request.call_id,
            channel_id = request.channel_id,
        )
    )]
    async fn build_voip_push_payloads<'a>(
        &self,
        request: VoipPushPayloadRequest<'a>,
    ) -> Vec<(MacroUserIdStr<'static>, VoipPushPayload)> {
        let room_name = request.room_name;
        let call_id = request.call_id;
        let channel_id = request.channel_id;
        let channel_name = request.channel_name;
        let caller_name = request.caller_name;
        let livekit_server_url = request.livekit_server_url;
        let ring_status_url = request.ring_status_url;

        let mut payloads = Vec::new();
        for batch in request.recipients.chunks(VOIP_TOKEN_MINT_CONCURRENCY) {
            let results = future::join_all(batch.iter().map(|recipient_id| {
                let recipient_id = recipient_id.clone();
                async move {
                    match self.generate_token(room_name, recipient_id.clone()).await {
                        Ok(livekit_token) => Some((
                            recipient_id,
                            VoipPushPayload {
                                aps: Default::default(),
                                call_id: call_id.to_string(),
                                channel_id: channel_id.to_string(),
                                channel_name: channel_name.to_string(),
                                caller_name: caller_name.to_string(),
                                livekit_server_url: Some(livekit_server_url.to_string()),
                                livekit_token: Some(livekit_token),
                                ring_status_url: ring_status_url.map(str::to_string),
                            },
                        )),
                        Err(e) => {
                            tracing::error!(
                                error=?e,
                                "failed to mint LiveKit token for VoIP push"
                            );
                            None
                        }
                    }
                }
            }))
            .await;
            payloads.extend(results.into_iter().flatten());
        }

        payloads
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
        let request = build_room_composite_egress_request(room_name, s3_config);

        let info = self
            .egress_client
            .start_room_composite_egress(&request.room_name, request.outputs, request.options)
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

    fn verify_access_token(&self, token: &str) -> anyhow::Result<VerifiedRingToken> {
        let claims = self
            .token_verifier
            .verify(token)
            .map_err(|e| anyhow::anyhow!("access token verification failed: {e}"))?;

        Ok(VerifiedRingToken {
            identity: claims.sub,
            room: Some(claims.video.room).filter(|r| !r.is_empty()),
        })
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
