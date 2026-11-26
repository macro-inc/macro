use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Granola's app in the connectors catalog.
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

/// A note as Granola lists it: enough to decide whether to fetch it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedNote {
    pub id: NoteId,
    /// Deleted notes are listed only to keys that can see the whole workspace.
    pub deleted: bool,
}

/// One page of the user's notes, newest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotesPage {
    pub notes: Vec<ListedNote>,
    /// Where the next page starts; `None` on the last page.
    pub next: Option<String>,
}

/// A leased page of a connection's history backfill. Completion is fenced by
/// `lease_id`; `cursor` is `None` for the first page.
pub struct BackfillJob {
    pub connection: Connection,
    pub cursor: Option<String>,
    pub lease_id: Uuid,
    /// Attempts at this page, including this one.
    pub attempts: i32,
    /// Notes of this page already handled by an earlier attempt; a retry
    /// skips them, so a slow page makes progress on every attempt.
    pub handled: Vec<NoteId>,
    /// Times in a row the user was not opted in, for backing off deferrals.
    pub deferrals: i32,
}

/// Why a backfilled note was given up on when its page moved on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::AsRefStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SkipReason {
    /// Granola kept failing to return the note.
    FetchFailed,
    /// The call import kept rejecting the note.
    ImportFailed,
    /// No attempt at the page reached the note within its time budget.
    OutOfTime,
}

/// A note a page moved on without importing; recorded durably by ID only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkippedNote {
    pub note_id: NoteId,
    pub reason: SkipReason,
}

/// Why a backfill stopped before Granola's last page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum GiveUpReason {
    /// The listing kept handing back the cursor it was given.
    RepeatedCursor,
}

/// How a backfill page ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackfillStep {
    /// The page was imported; continue from this cursor. `skipped` are
    /// the notes it gave up on after its last attempt.
    Next {
        cursor: String,
        skipped: Vec<SkippedNote>,
    },
    /// The last page was imported, except `skipped`.
    Done { skipped: Vec<SkippedNote> },
    /// The backfill cannot continue; stop it for good.
    GaveUp(GiveUpReason),
    /// The page failed; retry it after a backoff from its saved cursor.
    Retry,
    /// Granola rate-limited the page; retry it after this wait without
    /// spending one of its attempts, so throttling never causes skips.
    Throttled(std::time::Duration),
    /// Backfill is not rolled out to this user; check again later without
    /// calling Granola or spending an attempt.
    Deferred,
}

/// Granola answered 429: the key's request allowance is spent for now.
#[derive(Debug, thiserror::Error)]
#[error("Granola rate-limited the request")]
pub struct RateLimited {
    /// Granola's `Retry-After`, when it sent one in seconds.
    pub retry_after: Option<std::time::Duration>,
}

/// Why a sync is not healthy, stored as the connection's `last_error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
pub enum SyncIssue {
    /// The connection went away; a reconnect restarts sync at once.
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
