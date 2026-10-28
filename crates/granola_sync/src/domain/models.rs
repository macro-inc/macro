use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Granola's app slug in Pipedream.
pub const GRANOLA_APP: &str = "granola";

/// Webhook access scope. Sync always asks for the widest scope the key accepts:
/// `All` for personal keys, `Workspace` for workspace keys. `Personal` and
/// `Public` remain readable for connections stored before that policy.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Scope {
    Personal,
    Public,
    All,
    Workspace,
}

impl Scope {
    /// The scopes Granola's API accepts; `All` is our name for both personal ones.
    pub fn scopes(self) -> &'static [Scope] {
        match self {
            Self::Personal => &[Self::Personal],
            Self::Public => &[Self::Public],
            Self::All => &[Self::Personal, Self::Public],
            Self::Workspace => &[Self::Workspace],
        }
    }
}

/// Signing material must never appear in logs or API responses.
#[derive(Clone)]
pub struct SigningSecret(pub String);

/// Internal connection state. A connection ID changes when sync is restarted.
#[derive(Clone)]
pub struct Connection {
    pub id: Uuid,
    /// Stable import namespace, retained when credentials or webhooks change.
    pub namespace: Uuid,
    pub user_id: MacroUserIdStr<'static>,
    pub account_id: String,
    pub scope: Scope,
    pub enabled: bool,
    pub endpoint_id: Option<String>,
    pub secret: Option<SigningSecret>,
    pub started_at: DateTime<Utc>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: Option<SyncIssue>,
}

/// Events refer to meeting records, although Granola names those records notes.
#[derive(
    Debug,
    Clone,
    Copy,
    Deserialize,
    Serialize,
    strum::AsRefStr,
    strum::EnumString,
    strum::VariantArray,
)]
pub enum EventType {
    #[serde(rename = "note.generated")]
    #[strum(serialize = "note.generated")]
    Generated,
    #[serde(rename = "note.edited")]
    #[strum(serialize = "note.edited")]
    Edited,
    #[serde(rename = "note.access_granted")]
    #[strum(serialize = "note.access_granted")]
    AccessGranted,
}

/// Granola's opaque note ID. Encode it as a path segment before use in a URL.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(transparent)]
pub struct NoteId(pub String);

impl AsRef<str> for NoteId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Event {
    pub event_id: Uuid,
    pub event_type: EventType,
    pub note_id: NoteId,
    pub occurred_at: DateTime<Utc>,
}

/// A leased delivery. Completion is fenced by lease_id.
pub struct Job {
    pub connection: Connection,
    pub event: Event,
    pub lease_id: Uuid,
    pub attempts: i32,
}

/// Why a sync is not healthy, stored as the connection's `last_error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
pub enum SyncIssue {
    /// The account went away; a reconnect restarts sync at once.
    #[strum(serialize = "Sync stopped")]
    Stopped,
    /// Webhook registration failed; retried after a delay.
    #[strum(serialize = "Could not register Granola webhook")]
    SetupFailed,
    /// A delivery failed; it is retried with backoff while sync stays enabled.
    #[strum(serialize = "Meeting sync failed; retrying automatically")]
    MeetingSyncFailed,
}

/// Reconciliation view of a connection row.
pub struct SyncState {
    pub id: Uuid,
    pub user_id: MacroUserIdStr<'static>,
    pub account_id: String,
    pub scope: Scope,
    pub enabled: bool,
    pub has_endpoint: bool,
    pub started_at: DateTime<Utc>,
    pub last_error: Option<SyncIssue>,
}

/// Outcome of registering a webhook with one scope.
pub enum Registration {
    Registered(Webhook),
    /// Granola rejected the scope for this kind of key; try the next one.
    ScopeRejected,
}

/// Registration response; deliberately not Debug.
pub struct Webhook {
    pub id: String,
    pub secret: SigningSecret,
}

/// Raw authentication envelope. Verify before decoding the provider event.
pub struct Delivery<'a> {
    pub id: &'a str,
    pub timestamp: &'a str,
    pub signature: &'a str,
    pub body: &'a [u8],
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Sync setup is already running")]
    Conflict,
    #[error("Invalid webhook signature or payload")]
    InvalidDelivery,
    #[error("Granola sync is not configured")]
    Unavailable,
    #[error("Granola sync request failed: {0}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for SyncError {
    fn from(error: rootcause::Report) -> Self {
        Self::Internal(error)
    }
}
