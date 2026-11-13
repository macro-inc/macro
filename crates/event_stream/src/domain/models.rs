//! Event stream domain models.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use event_exposure::{Audience, EntityType, Stage};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

/// A public event normalized for filter matching and delivery.
///
/// Shared by both deliveries: persisted webhooks queue it (it is the webhook
/// queue contract, so its shape is frozen: `deny_unknown_fields`) and live
/// streams deliver its envelope as the SSE `data`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NormalizedEvent {
    /// Broker event identifier (UUIDv7). The subscriber's dedupe key.
    pub event_id: String,
    /// Version of the broker event payload schema.
    pub schema_version: u8,
    /// Public event name used for filter matching, such as `document.created`.
    pub event_name: String,
    /// Public entity type, such as `document` or `bot`.
    pub entity_type: String,
    /// Entity identifier used for `ids` filters.
    pub entity_id: String,
    /// Key that preserves the event ordering observed during ingestion.
    pub ordering_key: String,
    /// Time at which the event was normalized.
    pub occurred_at: DateTime<Utc>,
    /// The delivered body: the broker envelope with the event's public
    /// payload in place of its internal one.
    pub broker_envelope: serde_json::Value,
}

/// A public event with whose access decides who receives it, as written to
/// the public event log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicLogEvent {
    /// The normalized event.
    pub event: NormalizedEvent,
    /// Whose current access decides who receives the event. Resolved at
    /// fan-out and again on replay; never delivered.
    pub audience: Audience,
    /// Rollout stage: `preview` events reach only flagged users.
    pub stage: Stage,
}

/// Cached access facts an event changes. Every process evicts them before
/// delivering the event (or the next one, for internal events), so a revoked
/// subscriber stops receiving at once rather than after the cache lapses.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Invalidation {
    /// An entity's accessor set changed (participants, sharing).
    Entity {
        /// Access entity type.
        entity_type: EntityType,
        /// Entity identifier.
        entity_id: String,
    },
    /// A team's membership changed; `user_id` is the member whose teams
    /// changed, when the event names one.
    Team {
        /// The team.
        team_id: Uuid,
        /// The member who joined, left or changed role.
        user_id: Option<MacroUserIdStr<'static>>,
    },
    /// A bot was deleted: every stream it holds closes as revoked.
    BotDeleted {
        /// The deleted bot.
        bot_id: Uuid,
    },
}

/// One record of the public event log: a public event, cache
/// invalidations, or both.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogRecord {
    /// The public event, absent for an internal event that only changes
    /// access.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<PublicLogEvent>,
    /// Access facts to evict before delivering `event`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub invalidations: Vec<Invalidation>,
}

/// Position in the public event log: the Redis stream entry id
/// (`<unix ms>-<sequence>`). Totally ordered and valid on every instance.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Cursor {
    /// Unix milliseconds the entry was appended at.
    pub ms: u64,
    /// Sequence within that millisecond.
    pub seq: u64,
}

impl Cursor {
    /// The cursor before every entry appended at or after `ms`.
    pub fn floor_at(ms: u64) -> Self {
        Self { ms, seq: 0 }
    }
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}-{}", self.ms, self.seq)
    }
}

/// A cursor that is not a log entry id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid cursor")]
pub struct InvalidCursor;

impl FromStr for Cursor {
    type Err = InvalidCursor;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (ms, seq) = value.split_once('-').ok_or(InvalidCursor)?;
        Ok(Self {
            ms: ms.parse().map_err(|_| InvalidCursor)?,
            seq: seq.parse().map_err(|_| InvalidCursor)?,
        })
    }
}

/// One entry read from the public event log.
#[derive(Debug, Clone)]
pub struct LogEntry {
    /// The entry's position.
    pub cursor: Cursor,
    /// The record.
    pub record: LogRecord,
    /// The span this entry is processed under: parented on the trace that
    /// appended it, so the stream hop stays one trace.
    pub span: tracing::Span,
}

/// Personal or team workspace whose webhook lifecycle events a stream
/// delivers. Clients serialize this, so both derives are used. `Display` and
/// `FromStr` spell the same names as serde.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum WebhookScope {
    /// The authenticated user's personal workspace.
    User,
    /// The authenticated user's team workspace.
    Team,
}

/// Who holds a stream, and what that credential may see.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamPrincipal {
    /// The kind of credential.
    pub kind: PrincipalKind,
    /// Opaque credential identifier for limits and telemetry: never a raw
    /// secret, email or user id.
    pub credential_id: String,
}

/// The kinds of credential that may open a stream. A stream always follows
/// one user's access: a bot listens as the user it acts for, and a bot with
/// no acting user cannot open one. A harness runtime listens as the user it
/// acts for; internal credentials are never admitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrincipalKind {
    /// A user's own session, Macro API token or API key.
    User {
        /// The user.
        user: MacroUserIdStr<'static>,
        /// Whether the credential is a user API key (limited per key).
        api_key: bool,
    },
    /// An account manager's key for the managed user: the user's events
    /// minus webhook, bot and API key lifecycle.
    AccountManager {
        /// The managed user.
        user: MacroUserIdStr<'static>,
    },
    /// A harness runtime (the coding agent daemon) acting for its owner:
    /// the owner's events, personal ones included, as before streams had
    /// principals.
    Harness {
        /// The harness.
        harness_id: Uuid,
        /// The user it acts for.
        user: MacroUserIdStr<'static>,
    },
    /// A bot acting for a user.
    Bot {
        /// The bot.
        bot_id: Uuid,
        /// The acting user.
        user: MacroUserIdStr<'static>,
        /// Whether the acting user owns the bot. Only then does the bot see
        /// the user's personal events (`owner` and `recipient` rules); a
        /// team bot never does.
        owned_by_user: bool,
    },
}

impl PrincipalKind {
    /// The user whose access the stream follows.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        match self {
            Self::User { user, .. }
            | Self::AccountManager { user }
            | Self::Harness { user, .. }
            | Self::Bot { user, .. } => user,
        }
    }

    /// The bot holding the stream, when it is a bot.
    pub fn bot_id(&self) -> Option<Uuid> {
        match self {
            Self::Bot { bot_id, .. } => Some(*bot_id),
            Self::User { .. } | Self::AccountManager { .. } | Self::Harness { .. } => None,
        }
    }

    /// Whether personal rules (`owner`, `recipient`) can admit this
    /// principal: mail, calendar, notifications and activity are not for a
    /// bot unless the bot's owner is the acting user.
    pub fn sees_personal_events(&self) -> bool {
        match self {
            Self::User { .. } | Self::AccountManager { .. } | Self::Harness { .. } => true,
            Self::Bot { owned_by_user, .. } => *owned_by_user,
        }
    }

    /// Whether the credential acts as the account holder: the user's own, or
    /// a bot the user owns. Only they see the account's webhook, bot and API
    /// key lifecycle.
    pub fn is_account_holder(&self) -> bool {
        match self {
            Self::User { .. } | Self::Harness { .. } => true,
            Self::AccountManager { .. } => false,
            Self::Bot { owned_by_user, .. } => *owned_by_user,
        }
    }

    /// The span value for `principal.kind`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User { api_key: false, .. } => "user",
            Self::User { api_key: true, .. } => "api_key",
            Self::AccountManager { .. } => "account_manager",
            Self::Bot { .. } => "bot",
            Self::Harness { .. } => "harness",
        }
    }
}

/// Why a stream ended. Recorded on `events.stream.close`; every reason but
/// `client` and `shutdown` is also sent to the client as a control event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    /// The client disconnected.
    Client,
    /// The stream fell behind its buffer, or its access could not be
    /// resolved: the client resumes from its cursor.
    Lagged,
    /// The credential no longer validates.
    Revoked,
    /// The stream's bot was deleted.
    BotDeleted,
    /// The cursor fell out of the replay window: the client resyncs.
    Reset,
    /// The process is shutting down: the client resumes from its cursor.
    Shutdown,
}

impl CloseReason {
    /// The span value for the close reason.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Client => "client",
            Self::Lagged => "lagged",
            Self::Revoked | Self::BotDeleted => "revoked",
            Self::Reset => "reset",
            Self::Shutdown => "shutdown",
        }
    }
}

/// A control event sent to a client before the server closes its stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlEvent {
    /// The stream fell behind. Reconnect with `cursor` (absent without the
    /// `public-event-stream` flag, whose streams have no cursors).
    Lagged {
        /// The last cursor delivered on this stream.
        cursor: Option<String>,
    },
    /// The stream's credential was revoked.
    Revoked {
        /// Why: `credential` or `bot_deleted`.
        reason: &'static str,
    },
    /// The cursor is older than the replay window. Resync through the list
    /// APIs, then reconnect without a cursor.
    Reset,
}

impl ControlEvent {
    /// The SSE `event` name.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Lagged { .. } => "lagged",
            Self::Revoked { .. } => "revoked",
            Self::Reset => "reset",
        }
    }
}

/// One item a stream hands to its transport.
#[derive(Debug, Clone)]
pub enum StreamItem {
    /// A delivered event. `id` is the SSE id: the log cursor for flagged
    /// streams, the broker event id otherwise.
    Event {
        /// The SSE id.
        id: String,
        /// The event.
        event: Arc<NormalizedEvent>,
    },
    /// The last item before the server closes the stream.
    Control(ControlEvent),
}
