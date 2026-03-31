//! LiveKit adapter for the [`CallRtcClient`] port.
//!
//! Wraps the `livekit-api` crate to provide room management and token generation.

use livekit_api::access_token::{AccessToken, TokenVerifier, VideoGrants};
use livekit_api::services::room::{CreateRoomOptions, RoomClient};
use livekit_api::webhooks::WebhookReceiver;

use crate::domain::models::{CallError, CallWebhookEvent};
use crate::domain::ports::CallRtcClient;

/// LiveKit implementation of [`CallRtcClient`].
pub struct LivekitRtcClient {
    room_client: RoomClient,
    webhook_receiver: WebhookReceiver,
    api_key: String,
    api_secret: String,
}

impl LivekitRtcClient {
    /// Create a new LiveKit RTC client.
    ///
    /// # Arguments
    /// * `server_url` - LiveKit server URL (e.g. `https://my-livekit.example.com`)
    /// * `api_key` - LiveKit API key
    /// * `api_secret` - LiveKit API secret
    pub fn new(
        server_url: &str,
        api_key: impl Into<String>,
        api_secret: impl Into<String>,
    ) -> Self {
        let api_key = api_key.into();
        let api_secret = api_secret.into();
        let room_client = RoomClient::with_api_key(server_url, &api_key, &api_secret);
        let verifier = TokenVerifier::with_api_key(&api_key, &api_secret);
        let webhook_receiver = WebhookReceiver::new(verifier);
        Self {
            room_client,
            webhook_receiver,
            api_key,
            api_secret,
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
        participant_identity: &str,
    ) -> anyhow::Result<String> {
        let token = AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(participant_identity)
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
        participant_identity: &str,
    ) -> anyhow::Result<()> {
        self.room_client
            .remove_participant(room_name, participant_identity)
            .await?;
        Ok(())
    }

    fn receive_webhook(&self, body: &str, auth_token: &str) -> Result<CallWebhookEvent, CallError> {
        let event = self
            .webhook_receiver
            .receive(body, auth_token)
            .map_err(|e| CallError::Internal(anyhow::anyhow!("webhook validation failed: {e}")))?;

        Ok(CallWebhookEvent {
            event: event.event,
            id: event.id,
            room_name: event.room.map(|r| r.name),
            participant_identity: event.participant.map(|p| p.identity),
            created_at: event.created_at,
        })
    }
}
