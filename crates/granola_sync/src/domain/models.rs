use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Granola key access selected by the user. Workspace keys have a distinct scope.
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

/// Safe status shown in Settings; credentials and signing secrets are excluded.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub connected: bool,
    pub scope: Option<Scope>,
    pub started_at: Option<DateTime<Utc>>,
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
    #[error("Connect an enabled Granola account first")]
    NotConnected,
    #[error("Sync setup is already running; try again shortly")]
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
