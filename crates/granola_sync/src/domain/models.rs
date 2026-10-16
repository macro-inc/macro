use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Webhook access scope. Sync always asks for the widest scope the key accepts:
/// `All` for personal keys, `Workspace` for workspace keys. `Personal` and
/// `Public` remain readable for connections stored before that policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Personal,
    Public,
    All,
    Workspace,
}

impl Scope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Personal => "personal",
            Self::Public => "public",
            Self::All => "all",
            Self::Workspace => "workspace",
        }
    }

    pub fn scopes(self) -> Vec<&'static str> {
        match self {
            Self::Personal => vec!["personal"],
            Self::Public => vec!["public"],
            Self::All => vec!["personal", "public"],
            Self::Workspace => vec!["workspace"],
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
    pub last_error: Option<String>,
}

/// Events refer to meeting records, although Granola names those records notes.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub enum EventType {
    #[serde(rename = "note.generated")]
    Generated,
    #[serde(rename = "note.edited")]
    Edited,
    #[serde(rename = "note.access_granted")]
    AccessGranted,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generated => "note.generated",
            Self::Edited => "note.edited",
            Self::AccessGranted => "note.access_granted",
        }
    }
}

/// Validated provider identity, safe to embed in an API path.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct NoteId(String);

impl TryFrom<String> for NoteId {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let suffix = value
            .strip_prefix("not_")
            .ok_or("invalid Granola meeting ID")?;
        if suffix.len() != 14 || !suffix.bytes().all(|c| c.is_ascii_alphanumeric()) {
            return Err("invalid Granola meeting ID");
        }
        Ok(Self(value))
    }
}
impl From<NoteId> for String {
    fn from(value: NoteId) -> Self {
        value.0
    }
}
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

/// Marks a sync stopped because its account went away; a reconnect restarts it
/// at once, unlike a failed setup, which waits for the retry delay.
pub const STOPPED: &str = "Sync stopped";

/// Reconciliation view of a connection row.
pub struct SyncState {
    pub id: Uuid,
    pub user_id: MacroUserIdStr<'static>,
    pub account_id: String,
    pub scope: Scope,
    pub enabled: bool,
    pub has_endpoint: bool,
    pub started_at: DateTime<Utc>,
    pub last_error: Option<String>,
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
