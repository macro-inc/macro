//! Private LiveKit rooms, explicit worker dispatch and least-privilege join tokens.

use crate::domain::{
    model::{DispatchMetadata, Result, VoiceError, VoiceLease},
    ports::VoiceMedia,
};
use async_trait::async_trait;
use livekit_api::{
    access_token::{AccessToken, VideoGrants},
    services::{
        ServiceError, TwirpError, TwirpErrorCode,
        agent_dispatch::AgentDispatchClient,
        room::{CreateRoomOptions, RoomClient},
    },
};
use livekit_protocol::CreateAgentDispatchRequest;
use std::time::Duration;

/// Named worker registered independently from call transcription workers.
pub const VOICE_AGENT_NAME: &str = "macro-agent-voice";
const MEDIA_TIMEOUT: Duration = Duration::from_secs(20);
// The browser and worker both allow two minutes for a transient connection
// loss. Keep the room alive for that recovery window as well.
const RECONNECT_GRACE_SECONDS: u32 = 120;

/// LiveKit provisioning adapter. Credentials never cross the domain port.
pub struct LivekitVoiceMedia {
    rooms: RoomClient,
    agents: AgentDispatchClient,
    api_key: String,
    api_secret: String,
    websocket_url: String,
}

impl LivekitVoiceMedia {
    /// Validate configured URLs and credentials before serving requests.
    pub fn new(server_url: &str, api_key: String, api_secret: String) -> Result<Self> {
        let mut url = url::Url::parse(server_url)
            .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?;
        if url.host_str().is_none()
            || !matches!(url.scheme(), "https" | "http" | "wss" | "ws")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || api_key.trim().is_empty()
            || api_secret.trim().is_empty()
        {
            return Err(VoiceError::Infrastructure(rootcause::report!(
                "Invalid LiveKit voice configuration"
            )));
        }
        let secure = matches!(url.scheme(), "https" | "wss");
        url.set_scheme(if secure { "https" } else { "http" })
            .map_err(|_| {
                VoiceError::Infrastructure(rootcause::report!("Invalid LiveKit scheme"))
            })?;
        let rooms = RoomClient::with_api_key(url.as_str(), &api_key, &api_secret);
        let agents = AgentDispatchClient::with_api_key(url.as_str(), &api_key, &api_secret);
        url.set_scheme(if secure { "wss" } else { "ws" })
            .map_err(|_| {
                VoiceError::Infrastructure(rootcause::report!("Invalid LiveKit scheme"))
            })?;
        Ok(Self {
            rooms,
            agents,
            api_key,
            api_secret,
            websocket_url: url.to_string(),
        })
    }
}

#[async_trait]
impl VoiceMedia for LivekitVoiceMedia {
    async fn provision(&self, lease: &VoiceLease) -> Result<()> {
        let metadata = serde_json::to_string(&DispatchMetadata::from(lease))
            .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?;
        tokio::time::timeout(MEDIA_TIMEOUT, async {
            self.rooms
                .create_room(
                    &lease.room_name(),
                    CreateRoomOptions {
                        empty_timeout: 60,
                        departure_timeout: RECONNECT_GRACE_SECONDS,
                        max_participants: 2,
                        metadata: metadata.clone(),
                        ..Default::default()
                    },
                )
                .await?;
            self.agents
                .create_dispatch(CreateAgentDispatchRequest {
                    room: lease.room_name(),
                    agent_name: VOICE_AGENT_NAME.to_owned(),
                    metadata,
                    ..Default::default()
                })
                .await?;
            Ok::<_, ServiceError>(())
        })
        .await
        .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?
        .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))
    }

    async fn close(&self, lease: &VoiceLease) -> Result<()> {
        let result =
            tokio::time::timeout(MEDIA_TIMEOUT, self.rooms.delete_room(&lease.room_name()))
                .await
                .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?;
        match result {
            Ok(_) => Ok(()),
            Err(ServiceError::Twirp(TwirpError::Twirp(code)))
                if code.code == TwirpErrorCode::NOT_FOUND =>
            {
                Ok(())
            }
            Err(error) => Err(VoiceError::Infrastructure(rootcause::report!(error).into())),
        }
    }

    fn token(&self, lease: &VoiceLease, ttl_seconds: u32) -> Result<String> {
        AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(&lease.participant_identity())
            .with_ttl(Duration::from_secs(u64::from(ttl_seconds)))
            .with_grants(VideoGrants {
                room_join: true,
                room: lease.room_name(),
                can_publish: true,
                can_publish_sources: vec!["microphone".to_owned()],
                can_subscribe: true,
                // RPC delegation/transcripts require data; no room-admin or metadata grants.
                can_publish_data: true,
                ..Default::default()
            })
            .to_jwt()
            .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))
    }

    async fn is_open(&self, lease: &VoiceLease) -> Result<bool> {
        let rooms = tokio::time::timeout(
            MEDIA_TIMEOUT,
            self.rooms.list_rooms(vec![lease.room_name()]),
        )
        .await
        .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?
        .map_err(|error| VoiceError::Infrastructure(rootcause::report!(error).into()))?;
        Ok(rooms.iter().any(|room| room.name == lease.room_name()))
    }

    fn url(&self) -> &str {
        &self.websocket_url
    }
}

#[cfg(test)]
mod test;
