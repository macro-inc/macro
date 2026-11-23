//! Ports (trait contracts) for the time tracking domain.

use std::future::Future;

use chrono::{DateTime, SubsecRound, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

use crate::domain::models::{
    EntryValues, LoggedTime, NewEntryRow, RunningTimer, TimeEntry, TimeEntryCursor,
};

/// Source of the current time, injected so timer limits can be tested.
pub trait Clock: Send + Sync + 'static {
    /// The current instant.
    fn now(&self) -> DateTime<Utc>;
}

/// The real clock, read at Postgres's microsecond precision, so the instant a
/// start returns is the one a later read of the stored timer returns.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now().trunc_subsecs(6)
    }
}

/// Whether time tracking is on for a person.
///
/// Object-safe through `async_trait` so the composition root can choose the
/// rollout source (a feature flag, or a fixed answer) without a type parameter.
#[async_trait::async_trait]
pub trait TimeTrackingRollout: Send + Sync {
    /// True when the person may write time; any failure to decide is false.
    async fn enabled_for(&self, user_id: &MacroUserIdStr<'_>) -> bool;
}

/// What changed in a person's time tracking. Their open sessions read it
/// again; nothing else travels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeTrackingChange {
    /// Their running timer started, stopped or was discarded.
    pub timer: bool,
    /// The task whose entries changed, when any did.
    pub task_id: Option<String>,
}

/// Tells every open session of a person (another tab, their phone) that their
/// time tracking changed, so each reads it again.
pub trait TimeTrackingUpdates: Send + Sync + 'static {
    /// Best effort, after the change committed: a failure is logged by the
    /// adapter, never returned, and a session that misses it reads again when
    /// it reconnects.
    fn changed(&self, user_id: &MacroUserIdStr<'static>, change: TimeTrackingChange);
}

/// What the domain needs to know about a repository failure.
pub trait RepositoryError: std::error::Error + Send + Sync + 'static {
    /// The write gave up waiting for another write on the same task or timer;
    /// retrying may succeed.
    fn is_contended(&self) -> bool;
}

impl RepositoryError for std::convert::Infallible {
    fn is_contended(&self) -> bool {
        match *self {}
    }
}

/// Result of storing a typed entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertEntryOutcome {
    /// Stored, with the task's new Time logged.
    Inserted(LoggedTime),
    /// An entry with that id already exists, unchanged: a replay, or a collision.
    Existing(TimeEntry),
    /// The task is not a live task.
    TaskUnavailable,
}

/// Result of changing an entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateEntryOutcome {
    /// Written, with the task's new Time logged.
    Written(LoggedTime),
    /// The entry changed since the caller read it; nothing was written.
    Changed,
    /// The entry no longer exists.
    EntryMissing,
    /// The entry's task is not a live task.
    TaskUnavailable,
}

/// Result of deleting an entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeleteEntryOutcome {
    /// Deleted, with the task's new Time logged.
    Deleted(u32),
    /// The entry no longer exists.
    EntryMissing,
    /// The entry's task is not a live task.
    TaskUnavailable,
}

/// Result of starting a timer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartTimerOutcome {
    /// The new timer runs; the previous one's entry was saved with it.
    Started(Option<LoggedTime>),
    /// The person's timer is no longer the one the request expected.
    TimerChanged,
    /// The task is not a live task.
    TaskUnavailable,
    /// The new timer's id is another running timer's or an entry's, or the
    /// stopped timer's id is another entry's; nothing changed.
    IdTaken,
}

/// Result of stopping a timer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopTimerOutcome {
    /// The timer is gone and its entry saved.
    Stopped(LoggedTime),
    /// The timer was no longer running.
    TimerGone,
    /// Another entry already has the timer's id; the timer keeps running.
    IdTaken,
}

/// Outbound persistence for entries and timers.
///
/// Every write that adds, changes or removes an entry rewrites its task's Time
/// logged from the sum of the task's entries, in the same transaction, after
/// taking that task's lock, so concurrent writes on one task cannot leave a
/// stale total.
pub trait TimeTrackingRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: RepositoryError;

    /// Up to `limit` of the task's entries, newest day first, then newest id,
    /// strictly after `after`.
    fn entries(
        &self,
        task_id: &str,
        limit: u16,
        after: Option<TimeEntryCursor>,
    ) -> impl Future<Output = Result<Vec<TimeEntry>, Self::Err>> + Send;

    /// The task's Time logged; zero when it has none.
    fn task_total(&self, task_id: &str) -> impl Future<Output = Result<u32, Self::Err>> + Send;

    /// One entry by id.
    fn entry(&self, id: Uuid) -> impl Future<Output = Result<Option<TimeEntry>, Self::Err>> + Send;

    /// Store a typed entry unless an entry with its id exists. Only a live task
    /// takes new entries.
    fn insert_entry(
        &self,
        row: &NewEntryRow,
    ) -> impl Future<Output = Result<InsertEntryOutcome, Self::Err>> + Send;

    /// Replace the values of `user_id`'s entry `id`, unless it changed since
    /// the caller read it at `read_updated_at`. Only a live task's entries change.
    fn update_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        values: &EntryValues,
        read_updated_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<UpdateEntryOutcome, Self::Err>> + Send;

    /// Delete `user_id`'s entry `id`, returning the task's new Time logged.
    /// Only a live task's entries are deleted.
    fn delete_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<DeleteEntryOutcome, Self::Err>> + Send;

    /// The person's running timer.
    fn timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<RunningTimer>, Self::Err>> + Send;

    /// In one transaction: stop the person's running timer `previous` (its
    /// entry is `previous`, whose id is that timer's), then start `timer`.
    /// With no `previous`, the person must have no timer. When their timer is
    /// not the expected one, nothing changes. Only a live task takes a timer.
    fn start_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer: &RunningTimer,
        previous: Option<&NewEntryRow>,
    ) -> impl Future<Output = Result<StartTimerOutcome, Self::Err>> + Send;

    /// In one transaction: remove the person's timer whose id is `row.id` and
    /// store `row` as its entry. A trashed task's timer still stops.
    fn stop_timer(
        &self,
        row: &NewEntryRow,
    ) -> impl Future<Output = Result<StopTimerOutcome, Self::Err>> + Send;

    /// Remove the person's timer `timer_id` without saving anything.
    fn discard_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
