use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Dialpad's app id in Macro Connect.
pub const DIALPAD_APP: &str = "dialpad";

/// A Dialpad numeric id (call, user, webhook, subscription). Dialpad sends
/// these as JSON numbers in events and as strings in some responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct DialpadId(pub i64);

impl<'de> Deserialize<'de> for DialpadId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Number(i64),
            Text(String),
        }
        match Raw::deserialize(deserializer)? {
            Raw::Number(id) => Ok(Self(id)),
            Raw::Text(text) => text.parse().map(Self).map_err(serde::de::Error::custom),
        }
    }
}

impl std::fmt::Display for DialpadId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The webhook signing secret Macro generates; never logged or returned.
#[derive(Clone)]
pub struct SigningSecret(pub String);

/// How far back to import calls when a user first connects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize, utoipa::ToSchema)]
#[schema(as = DialpadBackfill)]
#[serde(rename_all = "snake_case")]
pub enum Backfill {
    /// New calls only.
    #[default]
    None,
    /// The last 7 days.
    Week,
    /// The last 30 days.
    Month,
    /// The last 90 days.
    Quarter,
}

impl Backfill {
    /// The earliest call start to import, relative to `now`.
    pub fn since(self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let days = match self {
            Self::None => return None,
            Self::Week => 7,
            Self::Month => 30,
            Self::Quarter => 90,
        };
        Some(now - chrono::Duration::days(days))
    }
}

/// The Dialpad resources one sync owns: a webhook and the call subscription
/// that delivers to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Registration {
    /// The webhook Dialpad delivers to.
    pub webhook_id: DialpadId,
    /// The call event subscription feeding the webhook.
    pub subscription_id: DialpadId,
}

/// One user's sync. The id is stable and names the webhook URL.
#[derive(Clone)]
pub struct Connection {
    /// Row id; names the webhook URL.
    pub id: Uuid,
    /// Stable import namespace, retained across reconnects.
    pub namespace: Uuid,
    /// The Macro user who connected Dialpad and owns imported calls.
    pub user_id: MacroUserIdStr<'static>,
    /// Whether deliveries are imported.
    pub enabled: bool,
    /// The connected Dialpad user, once setup has read it.
    pub dialpad_user_id: Option<DialpadId>,
    /// Dialpad resources registered for this sync, if any.
    pub registration: Option<Registration>,
    /// Present from the start of setup, so early deliveries verify.
    pub secret: Option<SigningSecret>,
    /// First-connect import of past calls.
    pub backfill: BackfillState,
    /// When the user last started connecting.
    pub enrolled_at: DateTime<Utc>,
    /// When a call last imported successfully.
    pub last_synced_at: Option<DateTime<Utc>>,
    /// Why the sync is not healthy, if it isn't.
    pub last_error: Option<SyncIssue>,
}

/// Progress of the first-connect import of past calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackfillState {
    /// Nothing to import, or the import finished.
    Done,
    /// Import calls started at or after `since`, resuming at `cursor`.
    Pending {
        /// Earliest call start to import.
        since: DateTime<Utc>,
        /// Dialpad's cursor for the next page, after the first.
        cursor: Option<String>,
    },
}

/// Why a sync is not healthy, stored as the connection's `last_error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
pub enum SyncIssue {
    /// The Dialpad connection was removed from Macro Connect.
    #[strum(serialize = "Sync stopped")]
    Stopped,
    /// Macro Connect needs the user to reconnect Dialpad.
    #[strum(serialize = "Reconnect Dialpad to keep syncing calls")]
    NeedsReauth,
    /// Webhook registration failed; retried after a delay.
    #[strum(serialize = "Could not subscribe to Dialpad calls")]
    SetupFailed,
    /// A call failed to sync; it is retried with backoff.
    #[strum(serialize = "Call sync failed; retrying automatically")]
    CallSyncFailed,
    /// The user disconnected Dialpad, or never finished connecting. The row
    /// stays so a reconnect keeps the import namespace.
    #[strum(serialize = "Disconnected")]
    Disconnected,
}

/// What the Settings page shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncStatus {
    /// The user has not connected Dialpad.
    NotConnected,
    /// Waiting for the user to finish connecting, or for setup.
    Connecting,
    /// Calls are syncing.
    Connected {
        /// When a call last imported successfully.
        last_synced_at: Option<DateTime<Utc>>,
        /// A problem that does not stop sync.
        issue: Option<SyncIssue>,
    },
    /// Sync is not running; `issue` says why.
    Failed {
        /// What stopped it.
        issue: SyncIssue,
    },
}

/// The call states Macro subscribes to. Anything else is not delivered.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, strum::AsRefStr, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CallState {
    /// The call ended; carries the call's details.
    Hangup,
    /// Dialpad's transcript is ready to fetch.
    CallTranscription,
    /// Dialpad's AI recap summary, in the payload.
    RecapSummary,
    /// Dialpad's AI action items, in the payload.
    RecapActionItems,
    /// A past call found by the first-connect import; never sent by Dialpad.
    Backfill,
    /// Any state Macro does not subscribe to; never stored.
    #[serde(other)]
    Other,
}

impl CallState {
    /// The states the call subscription asks for.
    pub const SUBSCRIBED: [Self; 4] = [
        Self::Hangup,
        Self::CallTranscription,
        Self::RecapSummary,
        Self::RecapActionItems,
    ];
}

/// Whether the external party called in or was called.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, strum::AsRefStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Direction {
    /// The external party called the Dialpad user.
    Inbound,
    /// The Dialpad user called the external party.
    Outbound,
}

/// The Dialpad user (or department) on Macro's side of a call.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Target {
    /// Dialpad user or department id.
    #[serde(default)]
    pub id: Option<DialpadId>,
    /// Display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Email address, when Dialpad has one.
    #[serde(default)]
    pub email: Option<String>,
    /// Phone number on Macro's side.
    #[serde(default)]
    pub phone: Option<String>,
}

/// The external party, matching `external_number`. `email` is often empty.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Contact {
    /// Dialpad's contact id; may be a URL.
    #[serde(default)]
    pub id: Option<String>,
    /// Display name; Dialpad uses the number when it has none.
    #[serde(default)]
    pub name: Option<String>,
    /// Email address; often empty.
    #[serde(default)]
    pub email: Option<String>,
    /// Phone number, normally E.164.
    #[serde(default)]
    pub phone: Option<String>,
}

/// The fields of a Dialpad call event (or call list item) Macro uses.
/// Timestamps are Unix milliseconds.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CallEvent {
    /// Dialpad's call id.
    pub call_id: DialpadId,
    /// The state this event reports.
    pub state: CallState,
    /// Who placed the call.
    #[serde(default)]
    pub direction: Option<Direction>,
    /// When Dialpad began handling the call.
    #[serde(default)]
    pub date_started: Option<i64>,
    /// When both sides were connected; absent for unanswered calls.
    #[serde(default)]
    pub date_connected: Option<i64>,
    /// When the call ended.
    #[serde(default)]
    pub date_ended: Option<i64>,
    /// When this event happened.
    #[serde(default)]
    pub event_timestamp: Option<i64>,
    /// The external party's number.
    #[serde(default)]
    pub external_number: Option<String>,
    /// The number on Macro's side.
    #[serde(default)]
    pub internal_number: Option<String>,
    /// The external party.
    #[serde(default)]
    pub contact: Option<Contact>,
    /// The Dialpad user or department on Macro's side.
    #[serde(default)]
    pub target: Option<Target>,
    /// The first call of a transferred call's chain.
    #[serde(default)]
    pub master_call_id: Option<DialpadId>,
    /// Link to the call in Dialpad, for company members.
    #[serde(default)]
    pub company_call_review_share_link: Option<String>,
    /// Dialpad's AI summary, on `recap_summary` events.
    #[serde(default)]
    pub recap_summary: Option<String>,
    /// Dialpad's AI action items, on `recap_action_items` events.
    #[serde(default)]
    pub recap_action_items: Option<Vec<String>>,
}

impl CallEvent {
    /// When the event happened; a call list item falls back to its end.
    pub fn occurred_at(&self) -> Option<DateTime<Utc>> {
        self.event_timestamp
            .or(self.date_ended)
            .or(self.date_started)
            .and_then(DateTime::from_timestamp_millis)
    }
}

/// One line of Dialpad's transcript.
#[derive(Debug, Clone, Deserialize)]
pub struct TranscriptLine {
    /// `transcript` for speech; moments and AI questions are other kinds.
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    /// What was said.
    #[serde(default)]
    pub content: Option<String>,
    /// The speaker's name.
    #[serde(default)]
    pub name: Option<String>,
    /// Naive ISO time, in UTC.
    #[serde(default)]
    pub time: Option<String>,
}

/// Dialpad's AI recap, read for imported past calls (live calls carry it in
/// their events).
#[derive(Debug, Clone, Default)]
pub struct Recap {
    /// Summary text, unless Dialpad returned its too-short placeholder.
    pub summary: Option<String>,
    /// Action items, in order.
    pub action_items: Vec<String>,
}

/// A call with stored deliveries waiting to be imported: one import covers
/// all of them. Completion is fenced by lease_id.
pub struct Job {
    /// The sync the call belongs to.
    pub connection: Connection,
    /// Dialpad's call id.
    pub call_id: DialpadId,
    /// Trace context of the earliest leased delivery's webhook request.
    pub traceparent: Option<String>,
    /// Fences completion to this claim.
    pub lease_id: Uuid,
    /// Most claims of any leased delivery, including this one.
    pub attempts: i32,
}

/// One page of past calls.
pub struct CallPage {
    /// Calls on this page.
    pub calls: Vec<CallEvent>,
    /// Cursor for the next page; `None` on the last.
    pub cursor: Option<String>,
}

/// A user's Dialpad grant, as Macro Connect reports it.
pub enum Grant {
    /// A usable access token; deliberately not Debug.
    Active(AccessToken),
    /// No Dialpad connection in Macro Connect.
    NotConnected,
    /// The user must reconnect.
    NeedsReauth,
}

/// A Dialpad bearer token. Redacts its Debug; use it as a header and drop it.
pub struct AccessToken(pub zeroize::Zeroizing<String>);

impl std::fmt::Debug for AccessToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AccessToken(redacted)")
    }
}

/// Why a webhook delivery was not accepted.
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// The signature, connection or payload did not check out.
    #[error("Invalid webhook signature or payload")]
    InvalidDelivery,
    /// Sync cannot accept deliveries on this deployment.
    #[error("Dialpad sync is not configured")]
    Unavailable,
    /// Storing the delivery failed.
    #[error("Dialpad sync request failed: {0}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for SyncError {
    fn from(error: rootcause::Report) -> Self {
        Self::Internal(error)
    }
}
