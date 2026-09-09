//! PostgreSQL representation, kept separate from the shared domain state.

use crate::NotificationState;

#[cfg(test)]
mod test;

/// SQLx representation of the `notification_state` PostgreSQL enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "notification_state", rename_all = "lowercase")]
pub enum PgNotificationState {
    /// An unacknowledged notification.
    Unseen,
    /// An acknowledged, active notification.
    Seen,
    /// A completed notification.
    Done,
}

impl From<NotificationState> for PgNotificationState {
    fn from(state: NotificationState) -> Self {
        match state {
            NotificationState::Unseen => Self::Unseen,
            NotificationState::Seen => Self::Seen,
            NotificationState::Done => Self::Done,
        }
    }
}

impl From<PgNotificationState> for NotificationState {
    fn from(state: PgNotificationState) -> Self {
        match state {
            PgNotificationState::Unseen => Self::Unseen,
            PgNotificationState::Seen => Self::Seen,
            PgNotificationState::Done => Self::Done,
        }
    }
}
