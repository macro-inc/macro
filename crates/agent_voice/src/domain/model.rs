//! Values exchanged by voice session capabilities.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Hard session duration; enforced by the worker as well as server cleanup.
pub const MAX_DURATION_SECONDS: u32 = 30 * 60;
/// A browser join credential never outlives this duration.
pub const JOIN_TOKEN_SECONDS: u32 = 5 * 60;

/// Identity of one private media session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct VoiceSessionId(pub Uuid);

/// The catalog supported by the first speech adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Voice {
    /// Marin.
    Marin,
    /// Cedar.
    Cedar,
    /// Alloy.
    Alloy,
    /// Coral.
    Coral,
    /// Sage.
    Sage,
    /// Verse.
    Verse,
}

impl Voice {
    /// Stable picker order and labels.
    pub fn catalog() -> Vec<VoiceOption> {
        [
            (Self::Marin, "Marin"),
            (Self::Cedar, "Cedar"),
            (Self::Alloy, "Alloy"),
            (Self::Coral, "Coral"),
            (Self::Sage, "Sage"),
            (Self::Verse, "Verse"),
        ]
        .into_iter()
        .map(|(id, label)| VoiceOption {
            id,
            label: label.to_owned(),
        })
        .collect()
    }
}

/// A selectable speech voice.
#[derive(Debug, Serialize, ToSchema)]
pub struct VoiceOption {
    /// Stable provider voice identifier.
    pub id: Voice,
    /// Human readable label.
    pub label: String,
}

/// Whether this session can start voice and the supported catalog.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOptions {
    /// The session uses a harness that supports voice.
    pub enabled: bool,
    /// Available voices for supported sessions.
    pub voices: Vec<VoiceOption>,
    /// Maximum duration of one media session.
    pub max_duration_seconds: u32,
}

/// Browser start/rejoin request. Reuse the client id on request retries.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartVoice {
    /// Selected voice, fixed for this media session.
    pub voice: Voice,
    /// Browser-generated idempotency key, distinct for every new conversation.
    pub client_session_id: Uuid,
}

/// Browser media credentials. Intentionally does not implement `Debug`.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConnection {
    /// Media session to end when leaving.
    pub voice_session_id: VoiceSessionId,
    /// Opaque room name.
    pub room_name: String,
    /// LiveKit websocket server URL.
    pub url: String,
    /// Short-lived, room-scoped browser credential.
    pub token: String,
    /// Exact browser participant identity expected by the worker.
    pub participant_identity: String,
    /// Exact worker participant identity the browser must trust.
    pub agent_identity: String,
    /// Absolute end of the media session, not just credential expiry.
    pub expires_at: DateTime<Utc>,
    /// Selected voice.
    pub voice: Voice,
    /// Maximum duration of a fresh session.
    pub max_duration_seconds: u32,
}

/// Controller lease lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LeaseState {
    /// Room creation/dispatch is in progress; concurrent retries wait.
    Starting,
    /// Room was dispatched and browser credentials may be renewed.
    Active,
    /// Cleanup is in progress; credentials may no longer be issued.
    Ending,
}

/// Shared controller record. Contains no credentials or conversation content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceLease {
    /// Canonical agent session identity.
    pub session_id: Uuid,
    /// Opaque media session identity.
    pub voice_session_id: VoiceSessionId,
    /// User controlling this private conversation.
    pub owner: MacroUserIdStr<'static>,
    /// Browser idempotency key.
    pub client_session_id: Uuid,
    /// The voice cannot change on an idempotent retry.
    pub voice: Voice,
    /// Fixed absolute session deadline.
    pub expires_at: DateTime<Utc>,
    /// Provisioning/cleanup phase.
    pub state: LeaseState,
}

impl VoiceLease {
    /// Room names never contain user or agent session identifiers.
    pub fn room_name(&self) -> String {
        format!("agent-voice-{}", self.voice_session_id.0)
    }
    /// Opaque identity, stable across browser rejoin.
    pub fn participant_identity(&self) -> String {
        format!("voice-user-{}", self.voice_session_id.0)
    }
    /// The one expected worker identity.
    pub fn agent_identity(&self) -> String {
        format!("voice-agent-{}", self.voice_session_id.0)
    }
}

/// Safe, versioned context passed to the named media worker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchMetadata {
    /// Wire schema version.
    pub schema_version: u8,
    /// Canonical agent session, for browser delegation correlation.
    pub session_id: Uuid,
    /// Private media session.
    pub voice_session_id: VoiceSessionId,
    /// Speech voice.
    pub voice: Voice,
    /// The only participant to which work may be delegated.
    pub participant_identity: String,
    /// Worker must join with this identity.
    pub agent_identity: String,
    /// Worker must stop at this absolute deadline.
    pub expires_at: DateTime<Utc>,
    /// Additional bound on worker lifetime.
    pub max_duration_seconds: u32,
}

impl From<&VoiceLease> for DispatchMetadata {
    fn from(lease: &VoiceLease) -> Self {
        Self {
            schema_version: 1,
            session_id: lease.session_id,
            voice_session_id: lease.voice_session_id,
            voice: lease.voice,
            participant_identity: lease.participant_identity(),
            agent_identity: lease.agent_identity(),
            expires_at: lease.expires_at,
            max_duration_seconds: MAX_DURATION_SECONDS,
        }
    }
}

/// Domain failures, mapped to safe HTTP errors at the edge.
#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    /// The selected execution harness is not certified in this release.
    #[error("Voice mode is currently available for Macro agents")]
    UnsupportedHarness,
    /// Caller is not the authenticated controller or supplied an invalid receipt.
    #[error("This voice session belongs to another user")]
    Forbidden,
    /// Another controller or an in-progress start/end owns the slot.
    #[error("A voice session is already active or changing; retry shortly")]
    Conflict,
    /// Requested session is no longer active.
    #[error("This voice session has ended")]
    Ended,
    /// Store/provider failure. Never expose its internal report in HTTP responses.
    #[error("Voice mode is temporarily unavailable")]
    Infrastructure(rootcause::Report),
}

/// Domain result.
pub type Result<T> = std::result::Result<T, VoiceError>;
