//! The ids of a user's active notifications of chosen event types, for
//! clients that act on them in bulk without reading their notification feed.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::future::Future;
use tracing::field::Empty;
use uuid::Uuid;

/// Ids returned when the caller names no limit.
pub const DEFAULT_LIMIT: u32 = 100;
/// The most ids one read returns: the largest batch the other notification
/// reads return and the clients mark at once.
pub const MAX_LIMIT: u32 = 500;

/// Storage of a user's notification states.
pub trait ActiveNotificationIdRepository: Send + Sync {
    /// Up to `limit` ids of the user's active (unseen or seen), non-deleted
    /// notifications whose event type is one of `event_types`, newest first.
    fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> impl Future<Output = Result<Vec<Uuid>, ActiveNotificationIdStorageError>> + Send;
}

/// Why storage could not read the ids.
#[derive(Debug, thiserror::Error)]
pub enum ActiveNotificationIdStorageError {
    /// The read ran past its statement timeout.
    #[error("Reading notification ids timed out")]
    TimedOut,
    /// Any other storage failure.
    #[error("Could not read notification ids: {0}")]
    Failed(Report),
}

/// A rejected or failed read of active notification ids.
#[derive(Debug, thiserror::Error)]
pub enum ActiveNotificationIdsError {
    /// A read names at least one event type.
    #[error("Choose at least one notification event type")]
    NoEventTypes,
    /// Every event type must be one notifications are stored with.
    #[error("Unknown notification event type: {0}")]
    UnknownEventType(String),
    /// The limit is between 1 and [`MAX_LIMIT`].
    #[error("Notification id limit must be between 1 and {MAX_LIMIT}")]
    InvalidLimit,
    /// Storage could not read the ids.
    #[error(transparent)]
    Storage(ActiveNotificationIdStorageError),
}

/// Reads the ids of a user's own active notifications.
pub struct ActiveNotificationIdService<R> {
    repository: R,
    known_event_types: &'static [&'static str],
}

impl<R: ActiveNotificationIdRepository> ActiveNotificationIdService<R> {
    /// Construct over the repository and the event types notifications are
    /// stored with.
    pub fn new(repository: R, known_event_types: &'static [&'static str]) -> Self {
        Self {
            repository,
            known_event_types,
        }
    }

    /// The ids of `user`'s active notifications of `event_types`, newest
    /// first: at most `limit`, [`DEFAULT_LIMIT`] when none is given. A storage
    /// failure is logged here, once.
    #[tracing::instrument(
        name = "notification.active_ids",
        skip_all,
        fields(
            event_type_count = event_types.len(),
            limit = Empty,
            notification.id_count = Empty,
            db.statement_timed_out = Empty,
            otel.status_code = Empty,
        )
    )]
    pub async fn list(
        &self,
        user: MacroUserIdStr<'_>,
        mut event_types: Vec<String>,
        limit: Option<u32>,
    ) -> Result<Vec<Uuid>, ActiveNotificationIdsError> {
        let limit = limit.unwrap_or(DEFAULT_LIMIT);
        let span = tracing::Span::current();
        span.record("limit", limit);
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(ActiveNotificationIdsError::InvalidLimit);
        }
        if event_types.is_empty() {
            return Err(ActiveNotificationIdsError::NoEventTypes);
        }
        if let Some(unknown) = event_types
            .iter()
            .find(|event_type| !self.known_event_types.contains(&event_type.as_str()))
        {
            return Err(ActiveNotificationIdsError::UnknownEventType(
                unknown.clone(),
            ));
        }

        event_types.sort();
        event_types.dedup();
        let read = self
            .repository
            .active_notification_ids(user, &event_types, limit)
            .await;
        let timed_out = matches!(read, Err(ActiveNotificationIdStorageError::TimedOut));
        span.record("db.statement_timed_out", timed_out);
        match read {
            Ok(ids) => {
                span.record("notification.id_count", ids.len());
                Ok(ids)
            }
            Err(error) => {
                span.record("otel.status_code", "ERROR");
                if timed_out {
                    tracing::warn!(
                        db.statement_timed_out = true,
                        "reading active notification ids timed out"
                    );
                } else {
                    tracing::error!(error = ?error, "failed to read active notification ids");
                }
                Err(ActiveNotificationIdsError::Storage(error))
            }
        }
    }
}

#[cfg(test)]
mod test;
