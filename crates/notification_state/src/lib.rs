#![deny(missing_docs)]
//! Shared notification lifecycle state and transition policy.
//!
//! Viewing timestamps are historical metadata, not another representation of state.
//! In particular, a notification backfilled as done may never have recorded a view.

pub mod graphql;

#[cfg(feature = "postgres")]
pub mod postgres;

#[cfg(test)]
mod test;

/// The mutually exclusive lifecycle states of a user's notification.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum NotificationState {
    /// The notification has not been acknowledged.
    #[default]
    Unseen,
    /// The notification has been acknowledged but is not completed.
    Seen,
    /// The notification has been completed.
    Done,
}

impl NotificationState {
    /// States included by the default active-notification list.
    pub const ACTIVE: [Self; 2] = [Self::Unseen, Self::Seen];

    /// The canonical name used in JSON and PostgreSQL.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unseen => "unseen",
            Self::Seen => "seen",
            Self::Done => "done",
        }
    }

    /// Apply a user's intent without reopening a completed notification on a late view.
    ///
    /// Reopening always produces `Seen`, never `Unseen`. Operations are idempotent.
    /// Persistence adapters must implement these transitions atomically against the
    /// current stored state, rather than writing a state computed from a stale read.
    pub const fn apply(self, action: NotificationAction) -> Self {
        match (self, action) {
            (Self::Unseen, NotificationAction::MarkSeen) => Self::Seen,
            (_, NotificationAction::MarkDone) => Self::Done,
            (Self::Done, NotificationAction::Reopen) => Self::Seen,
            _ => self,
        }
    }
}

impl std::fmt::Display for NotificationState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A value is not one of the canonical notification state names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParseNotificationStateError;

impl std::fmt::Display for ParseNotificationStateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("expected unseen, seen, or done")
    }
}

impl std::error::Error for ParseNotificationStateError {}

impl std::str::FromStr for NotificationState {
    type Err = ParseNotificationStateError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "unseen" => Ok(Self::Unseen),
            "seen" => Ok(Self::Seen),
            "done" => Ok(Self::Done),
            _ => Err(ParseNotificationStateError),
        }
    }
}

/// User intent for changing a notification's state.
///
/// An intent is not simply a target state: viewing must preserve `Done`, whereas
/// reopening explicitly transitions from `Done` to `Seen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationAction {
    /// Acknowledge a notification without reopening it if already completed.
    MarkSeen,
    /// Complete a notification, including one that has not previously been seen.
    MarkDone,
    /// Reopen a completed notification as seen; leave active notifications unchanged.
    Reopen,
}

impl NotificationAction {
    /// Whether this action should clear the notification's mobile push.
    pub const fn should_clear_push_notifications(self) -> bool {
        matches!(self, Self::MarkSeen | Self::MarkDone)
    }
}
