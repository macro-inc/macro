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

/// One instance's hold on a sync's setup, named by when it began. Setup
/// finishes only under the lease that stored the signing secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SetupLease(pub DateTime<Utc>);

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
    /// Setup observed with this snapshot, fencing asynchronous grant checks.
    pub setup_lease: Option<SetupLease>,
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
    /// Why the sync is not healthy, if it isn't. A running sync stores only
    /// [`SyncIssue::NeedsReauth`]; call failures are read from `calls`.
    pub last_error: Option<SyncIssue>,
    /// Whether any call is failing to import.
    pub calls: CallHealth,
}

/// Whether a sync's calls are importing, read from their pending events so
/// one call's success never hides another's failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CallHealth {
    /// No call is failing.
    #[default]
    Healthy,
    /// A call failed and will retry.
    Retrying,
    /// A call used up its attempts; only a new event for it tries again.
    Abandoned,
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
        /// Pages that failed in a row; each failure backs off further.
        failures: i32,
    },
}

/// Why a sync is not healthy. Connection issues are stored as the
/// connection's `last_error`; call issues are read from [`CallHealth`].
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
    /// A call failed every attempt; it is retried only if Dialpad sends a
    /// new event for it.
    #[strum(serialize = "Some calls could not be imported")]
    CallsAbandoned,
    /// Setup failed every attempt; it waits for the user to reconnect.
    #[strum(serialize = "Setup could not finish")]
    SetupAbandoned,
    /// A page of past calls failed to import; it retries with backoff.
    #[strum(serialize = "Importing past calls failed; retrying")]
    BackfillFailed,
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
/// Timestamps are Unix milliseconds. Dialpad's shapes vary, so fields that
/// have been seen in more than one shape decode leniently; what is stored
/// is always the shape declared here.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CallEvent {
    /// Dialpad's call id.
    pub call_id: DialpadId,
    /// The state this event reports.
    pub state: CallState,
    /// When Dialpad began handling the call.
    #[serde(default, deserialize_with = "lenient::millis")]
    pub date_started: Option<i64>,
    /// When both sides were connected; absent for unanswered calls.
    #[serde(default, deserialize_with = "lenient::millis")]
    pub date_connected: Option<i64>,
    /// When the call ended.
    #[serde(default, deserialize_with = "lenient::millis")]
    pub date_ended: Option<i64>,
    /// When this event happened.
    #[serde(default, deserialize_with = "lenient::millis")]
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
    /// Link to the call in Dialpad, for company members.
    #[serde(default)]
    pub company_call_review_share_link: Option<String>,
    /// Dialpad's AI summary, on `recap_summary` events.
    #[serde(default)]
    pub recap_summary: Option<String>,
    /// Dialpad's AI action items, on `recap_action_items` events, sent as
    /// strings or as `{"content": ...}` objects.
    #[serde(default, deserialize_with = "lenient::action_items")]
    pub recap_action_items: Option<Vec<String>>,
}

/// Decoders for fields Dialpad sends in more than one shape.
mod lenient {
    use serde::{Deserialize, Deserializer, de::Error};
    use serde_json::Value;

    /// Unix milliseconds as a number or a numeric string; blank is absent.
    pub fn millis<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
        let number = match Option::<Value>::deserialize(deserializer)? {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Number(number)) => number,
            Some(Value::String(text)) if text.trim().is_empty() => return Ok(None),
            Some(Value::String(text)) => text
                .trim()
                .parse()
                .map_err(|_| D::Error::custom("expected a numeric timestamp"))?,
            Some(_) => return Err(D::Error::custom("expected a numeric timestamp")),
        };
        number
            .as_i64()
            .or_else(|| number.as_f64().map(|millis| millis.trunc() as i64))
            .map(Some)
            .ok_or_else(|| D::Error::custom("expected a numeric timestamp"))
    }

    /// Strings or `{"content": ...}` objects; items without text are skipped.
    pub fn action_items<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Vec<String>>, D::Error> {
        let Some(items) = Option::<Vec<Value>>::deserialize(deserializer)? else {
            return Ok(None);
        };
        items
            .into_iter()
            .filter_map(|item| match item {
                Value::Null => None,
                Value::String(text) => Some(Ok(text)),
                Value::Object(mut item) => match item.remove("content") {
                    Some(Value::String(text)) => Some(Ok(text)),
                    None | Some(Value::Null) => None,
                    Some(_) => Some(Err(D::Error::custom("expected text content"))),
                },
                _ => Some(Err(D::Error::custom(
                    "expected a string or an object with content",
                ))),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    }
}

impl CallEvent {
    /// Decode one event, or name the field that does not fit: its path only,
    /// since serde's messages can quote the value and events carry call
    /// details.
    pub fn decode(value: serde_json::Value) -> std::result::Result<Self, String> {
        serde_path_to_error::deserialize(value).map_err(|error| error.path().to_string())
    }

    /// When the event happened; a call list item falls back to its end.
    pub fn occurred_at(&self) -> Option<DateTime<Utc>> {
        self.event_timestamp
            .or(self.date_ended)
            .or(self.date_started)
            .and_then(DateTime::from_timestamp_millis)
    }

    /// The Dialpad user whose call this is.
    pub fn target_id(&self) -> Option<DialpadId> {
        self.target.as_ref().and_then(|target| target.id)
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

/// How a claimed call's import ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobOutcome {
    /// Imported, or nothing to import.
    Done,
    /// Failed; retry with backoff.
    Retry,
    /// Failed its last attempt; wait for a new event for the call.
    GiveUp,
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
    /// The connection or the signature did not check out. A signed event
    /// that cannot be read is acknowledged and dropped instead.
    #[error("Invalid webhook signature")]
    InvalidDelivery,
    /// Sync cannot accept deliveries on this deployment.
    #[error("Dialpad sync is not configured")]
    Unavailable,
    /// Storing the delivery failed.
    #[error("Dialpad sync request failed: {0}")]
    Internal(rootcause::Report),
}

/// Why a call's transcript could not be read.
#[derive(Debug, thiserror::Error)]
pub enum TranscriptError {
    /// Dialpad rejected the access token; the import must wait for it.
    #[error("Dialpad rejected the access token")]
    Unauthorized,
    /// Anything else (rate limit, outage, unreadable reply); the call imports
    /// without its transcript.
    #[error("Dialpad transcript unavailable: {0}")]
    Unavailable(rootcause::Report),
}

impl From<rootcause::Report> for SyncError {
    fn from(error: rootcause::Report) -> Self {
        Self::Internal(error)
    }
}

#[cfg(test)]
mod test;
